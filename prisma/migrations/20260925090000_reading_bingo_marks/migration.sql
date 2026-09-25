CREATE TABLE IF NOT EXISTS "ReadingBingoMark" (
  "userId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "squareKey" TEXT NOT NULL,
  "nota" TEXT,
  "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadingBingoMark_pkey" PRIMARY KEY ("userId", "year", "squareKey")
);

CREATE INDEX IF NOT EXISTS "ReadingBingoMark_userId_year_idx"
  ON "ReadingBingoMark"("userId", "year");

DO $$ BEGIN
  ALTER TABLE "ReadingBingoMark"
    ADD CONSTRAINT "ReadingBingoMark_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
