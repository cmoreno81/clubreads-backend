ALTER TABLE "Book"
  ADD COLUMN "normalizedIsbn" TEXT,
  ADD COLUMN "canonicalKey" TEXT;

CREATE TABLE "BookRedirect" (
  "oldBookId" TEXT NOT NULL,
  "canonicalBookId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookRedirect_pkey" PRIMARY KEY ("oldBookId")
);

CREATE TABLE "BookMergeAudit" (
  "id" TEXT NOT NULL,
  "sourceBookId" TEXT NOT NULL,
  "canonicalBookId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookMergeAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BookRedirect"
  ADD CONSTRAINT "BookRedirect_canonicalBookId_fkey"
  FOREIGN KEY ("canonicalBookId") REFERENCES "Book"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION clubreads_normalize_text(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(value, '')),
        'áàäâãåéèëêíìïîóòöôõúùüûñçýÿ',
        'aaaaaaeeeeiiiiooooouuuuncyy'),
      '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION clubreads_normalize_isbn(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN length(regexp_replace(upper(coalesce(value, '')), '[^0-9X]', '', 'g')) IN (10, 13)
    THEN regexp_replace(upper(coalesce(value, '')), '[^0-9X]', '', 'g')
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION clubreads_set_book_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE author_name TEXT;
BEGIN
  SELECT "name" INTO author_name FROM "Author" WHERE "id" = NEW."authorId";
  NEW."normalizedIsbn" := clubreads_normalize_isbn(NEW."isbn");
  NEW."canonicalKey" := clubreads_normalize_text(NEW."title") || '::' || clubreads_normalize_text(author_name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Book_set_canonical_identity"
BEFORE INSERT OR UPDATE OF "title", "authorId", "isbn"
ON "Book"
FOR EACH ROW EXECUTE FUNCTION clubreads_set_book_identity();

CREATE OR REPLACE FUNCTION clubreads_refresh_author_book_identities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Book" SET "authorId" = "authorId" WHERE "authorId" = NEW."id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Author_refresh_book_identities"
AFTER UPDATE OF "name" ON "Author"
FOR EACH ROW
WHEN (OLD."name" IS DISTINCT FROM NEW."name")
EXECUTE FUNCTION clubreads_refresh_author_book_identities();

UPDATE "Book" book
SET
  "normalizedIsbn" = clubreads_normalize_isbn(book."isbn"),
  "canonicalKey" = clubreads_normalize_text(book."title") || '::' ||
    clubreads_normalize_text((SELECT author."name" FROM "Author" author WHERE author."id" = book."authorId"));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Book"
    WHERE "deletedAt" IS NULL AND "normalizedIsbn" IS NOT NULL
    GROUP BY "normalizedIsbn" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "Book"
    WHERE "deletedAt" IS NULL
    GROUP BY "canonicalKey" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'BOOK_DUPLICATES_MUST_BE_RESOLVED_BEFORE_UNIQUE_INDEXES';
  END IF;
END $$;

CREATE UNIQUE INDEX "Book_active_normalizedIsbn_key"
  ON "Book"("normalizedIsbn")
  WHERE "deletedAt" IS NULL AND "normalizedIsbn" IS NOT NULL;

CREATE UNIQUE INDEX "Book_active_canonicalKey_key"
  ON "Book"("canonicalKey")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Book_canonicalKey_idx" ON "Book"("canonicalKey");
CREATE INDEX "Book_normalizedIsbn_idx" ON "Book"("normalizedIsbn");
CREATE INDEX "BookRedirect_canonicalBookId_idx" ON "BookRedirect"("canonicalBookId");
CREATE INDEX "BookMergeAudit_sourceBookId_idx" ON "BookMergeAudit"("sourceBookId");
CREATE INDEX "BookMergeAudit_canonicalBookId_idx" ON "BookMergeAudit"("canonicalBookId");
