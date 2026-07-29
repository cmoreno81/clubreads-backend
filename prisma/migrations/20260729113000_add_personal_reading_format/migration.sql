CREATE TYPE "ReadingFormat" AS ENUM ('PHYSICAL', 'DIGITAL', 'AUDIOBOOK');

ALTER TABLE "Library"
  ADD COLUMN "readingFormat" "ReadingFormat";

ALTER TABLE "ReadingCompletion"
  ADD COLUMN "readingFormat" "ReadingFormat";
