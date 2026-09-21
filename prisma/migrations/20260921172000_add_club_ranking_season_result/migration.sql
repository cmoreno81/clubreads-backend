CREATE TABLE IF NOT EXISTS "ClubRankingSeasonResult" (
  "clubId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "totalPoints" INTEGER NOT NULL,
  "activeMembers" INTEGER NOT NULL,
  "avgPoints" DOUBLE PRECISION NOT NULL,
  "rankTotal" INTEGER NOT NULL,
  "rankAvg" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubRankingSeasonResult_pkey" PRIMARY KEY ("clubId", "seasonNumber")
);

CREATE INDEX IF NOT EXISTS "ClubRankingSeasonResult_seasonNumber_rankTotal_idx"
  ON "ClubRankingSeasonResult"("seasonNumber", "rankTotal");

CREATE INDEX IF NOT EXISTS "ClubRankingSeasonResult_seasonNumber_rankAvg_idx"
  ON "ClubRankingSeasonResult"("seasonNumber", "rankAvg");

DO $$ BEGIN
  ALTER TABLE "ClubRankingSeasonResult"
    ADD CONSTRAINT "ClubRankingSeasonResult_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
