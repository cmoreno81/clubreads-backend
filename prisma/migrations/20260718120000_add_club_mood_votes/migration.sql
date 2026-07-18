CREATE TYPE "ClubMood" AS ENUM (
  'HOOKED',
  'SHOCKED',
  'CRYING',
  'ANGRY',
  'LAUGHING',
  'BLOCKED'
);

CREATE TABLE "ClubMoodVote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "mood" "ClubMood" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubMoodVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubMoodVote_userId_weekKey_key"
ON "ClubMoodVote"("userId", "weekKey");

CREATE INDEX "ClubMoodVote_weekKey_idx" ON "ClubMoodVote"("weekKey");

ALTER TABLE "ClubMoodVote"
ADD CONSTRAINT "ClubMoodVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
