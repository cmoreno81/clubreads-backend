ALTER TABLE "Book"
  ADD COLUMN IF NOT EXISTS "language" TEXT;

CREATE INDEX IF NOT EXISTS "Book_language_idx"
  ON "Book"("language");
