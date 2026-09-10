-- Ligas de ClubReads: ranking individual por temporadas quincenales.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RankingEventType" AS ENUM (
    'CHECKIN',
    'STREAK_BONUS',
    'PAGES',
    'BOOK_FINISHED',
    'FIRST_BOOK_OF_MONTH',
    'SAGA_COMPLETED',
    'REVIEW',
    'BOOK_OF_YEAR_PICK',
    'QUIZ'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RankingParticipation" (
  "userId" TEXT NOT NULL,
  "optedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingParticipation_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "RankingPointEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "type" "RankingEventType" NOT NULL,
  "points" INTEGER NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingPointEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RankingSeasonResult" (
  "userId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "totalPoints" INTEGER NOT NULL,
  "rank" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingSeasonResult_pkey" PRIMARY KEY ("userId", "seasonNumber")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "RankingPointEvent_userId_seasonNumber_dedupeKey_key"
  ON "RankingPointEvent"("userId", "seasonNumber", "dedupeKey");
CREATE INDEX IF NOT EXISTS "RankingPointEvent_seasonNumber_userId_idx"
  ON "RankingPointEvent"("seasonNumber", "userId");
CREATE INDEX IF NOT EXISTS "RankingSeasonResult_seasonNumber_rank_idx"
  ON "RankingSeasonResult"("seasonNumber", "rank");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "RankingParticipation"
    ADD CONSTRAINT "RankingParticipation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RankingPointEvent"
    ADD CONSTRAINT "RankingPointEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RankingSeasonResult"
    ADD CONSTRAINT "RankingSeasonResult_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
