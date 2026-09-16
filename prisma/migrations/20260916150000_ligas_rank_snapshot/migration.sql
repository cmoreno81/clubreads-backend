CREATE TABLE IF NOT EXISTS "RankingRankSnapshot" (
  "userId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "rank" INTEGER NOT NULL,
  "previousRank" INTEGER,
  "points" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RankingRankSnapshot_pkey" PRIMARY KEY ("userId", "seasonNumber")
);

CREATE INDEX IF NOT EXISTS "RankingRankSnapshot_seasonNumber_idx"
  ON "RankingRankSnapshot"("seasonNumber");

DO $$ BEGIN
  ALTER TABLE "RankingRankSnapshot"
    ADD CONSTRAINT "RankingRankSnapshot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
