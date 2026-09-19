DO $$ BEGIN
  CREATE TYPE "MedalTier" AS ENUM (
    'PODIO_ORO',
    'PODIO_PLATA',
    'PODIO_BRONCE',
    'ASCENSO',
    'DIAMANTE',
    'CONSTANCIA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SeasonMedal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "division" "RankingDivision" NOT NULL,
  "tier" "MedalTier" NOT NULL,
  "rank" INTEGER,
  "streak" INTEGER,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeasonMedal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeasonMedal_userId_seasonNumber_tier_key"
  ON "SeasonMedal"("userId", "seasonNumber", "tier");

CREATE INDEX IF NOT EXISTS "SeasonMedal_seasonNumber_idx"
  ON "SeasonMedal"("seasonNumber");

CREATE INDEX IF NOT EXISTS "SeasonMedal_userId_awardedAt_idx"
  ON "SeasonMedal"("userId", "awardedAt");

DO $$ BEGIN
  ALTER TABLE "SeasonMedal"
    ADD CONSTRAINT "SeasonMedal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
