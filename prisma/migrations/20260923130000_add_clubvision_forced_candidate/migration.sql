CREATE TABLE IF NOT EXISTS "ClubvisionForcedCandidate" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "edition" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubvisionForcedCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClubvisionForcedCandidate_clubId_edition_bookId_key"
  ON "ClubvisionForcedCandidate"("clubId", "edition", "bookId");

CREATE INDEX IF NOT EXISTS "ClubvisionForcedCandidate_clubId_edition_idx"
  ON "ClubvisionForcedCandidate"("clubId", "edition");

DO $$ BEGIN
  ALTER TABLE "ClubvisionForcedCandidate"
    ADD CONSTRAINT "ClubvisionForcedCandidate_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClubvisionForcedCandidate"
    ADD CONSTRAINT "ClubvisionForcedCandidate_bookId_fkey"
    FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClubvisionForcedCandidate"
    ADD CONSTRAINT "ClubvisionForcedCandidate_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
