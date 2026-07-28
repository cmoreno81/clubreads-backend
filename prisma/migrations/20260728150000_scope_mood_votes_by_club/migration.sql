-- Complete the legacy backfill before enforcing tenant boundaries.
-- The ALTER ... SET NOT NULL statements deliberately abort deployment if the
-- founder club does not exist, instead of silently leaving unscoped rows.
UPDATE "Reading"
SET "clubId" = (
  SELECT "id" FROM "Club"
  WHERE "slug" = 'nuestros-gustos-son-cliches'
)
WHERE "clubId" IS NULL;

UPDATE "Clubvision"
SET "clubId" = (
  SELECT "id" FROM "Club"
  WHERE "slug" = 'nuestros-gustos-son-cliches'
)
WHERE "clubId" IS NULL;

UPDATE "ClubvisionResult"
SET "clubId" = (
  SELECT "id" FROM "Club"
  WHERE "slug" = 'nuestros-gustos-son-cliches'
)
WHERE "clubId" IS NULL;

UPDATE "ClubMoodVote"
SET "clubId" = (
  SELECT "id"
  FROM "Club"
  WHERE "slug" = 'nuestros-gustos-son-cliches'
)
WHERE "clubId" IS NULL;

ALTER TABLE "Reading" ALTER COLUMN "clubId" SET NOT NULL;
ALTER TABLE "Clubvision" ALTER COLUMN "clubId" SET NOT NULL;
ALTER TABLE "ClubvisionResult" ALTER COLUMN "clubId" SET NOT NULL;
ALTER TABLE "ClubMoodVote" ALTER COLUMN "clubId" SET NOT NULL;

DROP INDEX IF EXISTS "ClubMoodVote_userId_weekKey_key";
DROP INDEX IF EXISTS "ClubMoodVote_clubId_idx";
DROP INDEX IF EXISTS "Reading_clubId_idx";
DROP INDEX IF EXISTS "Clubvision_clubId_idx";
DROP INDEX IF EXISTS "Clubvision_edition_key";
DROP INDEX IF EXISTS "ClubvisionResult_edition_key";

CREATE UNIQUE INDEX "ClubMoodVote_clubId_userId_weekKey_key"
  ON "ClubMoodVote"("clubId", "userId", "weekKey");

CREATE INDEX "ClubMoodVote_clubId_weekKey_idx"
  ON "ClubMoodVote"("clubId", "weekKey");

CREATE INDEX "Reading_clubId_status_idx"
  ON "Reading"("clubId", "status");

CREATE INDEX "Reading_clubId_bookId_status_idx"
  ON "Reading"("clubId", "bookId", "status");

CREATE UNIQUE INDEX "Reading_one_active_per_club_book"
  ON "Reading"("clubId", "bookId")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Clubvision_clubId_edition_key"
  ON "Clubvision"("clubId", "edition");

CREATE INDEX "Clubvision_clubId_status_idx"
  ON "Clubvision"("clubId", "status");

CREATE UNIQUE INDEX "ClubvisionResult_clubId_edition_key"
  ON "ClubvisionResult"("clubId", "edition");

-- A ballot row cannot point at a candidate from another Clubvisión.
ALTER TABLE "ClubvisionVote"
  DROP CONSTRAINT "ClubvisionVote_candidateId_fkey";

CREATE UNIQUE INDEX "ClubvisionCandidate_id_clubvisionId_key"
  ON "ClubvisionCandidate"("id", "clubvisionId");

ALTER TABLE "ClubvisionVote"
  ADD CONSTRAINT "ClubvisionVote_candidateId_clubvisionId_fkey"
  FOREIGN KEY ("candidateId", "clubvisionId")
  REFERENCES "ClubvisionCandidate"("id", "clubvisionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
