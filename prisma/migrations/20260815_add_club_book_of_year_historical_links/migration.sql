CREATE TABLE "ClubBookOfYearHistoricalLink" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "resultId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubBookOfYearHistoricalLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubBookOfYearHistoricalLink_resultId_key"
  ON "ClubBookOfYearHistoricalLink"("resultId");
CREATE INDEX "ClubBookOfYearHistoricalLink_clubId_year_idx"
  ON "ClubBookOfYearHistoricalLink"("clubId", "year");
CREATE INDEX "ClubBookOfYearHistoricalLink_bookId_idx"
  ON "ClubBookOfYearHistoricalLink"("bookId");

ALTER TABLE "ClubBookOfYearHistoricalLink"
  ADD CONSTRAINT "ClubBookOfYearHistoricalLink_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearHistoricalLink"
  ADD CONSTRAINT "ClubBookOfYearHistoricalLink_resultId_fkey"
  FOREIGN KEY ("resultId") REFERENCES "ClubvisionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearHistoricalLink"
  ADD CONSTRAINT "ClubBookOfYearHistoricalLink_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
