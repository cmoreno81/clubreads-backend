ALTER TABLE "Book"
  ADD COLUMN IF NOT EXISTS "publicationDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publisher" TEXT;

CREATE INDEX IF NOT EXISTS "Book_publicationDate_idx"
  ON "Book"("publicationDate");

CREATE TABLE IF NOT EXISTS "BookSource" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "externalId" TEXT,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookSource_source_sourceUrl_key"
  ON "BookSource"("source", "sourceUrl");
CREATE INDEX IF NOT EXISTS "BookSource_bookId_idx"
  ON "BookSource"("bookId");
CREATE INDEX IF NOT EXISTS "BookSource_source_externalId_idx"
  ON "BookSource"("source", "externalId");

DO $$
BEGIN
  ALTER TABLE "BookSource"
    ADD CONSTRAINT "BookSource_bookId_fkey"
    FOREIGN KEY ("bookId") REFERENCES "Book"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
