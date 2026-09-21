DO $$ BEGIN
  CREATE TYPE "ClubJoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClubJoinRequest" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "ClubJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "respondedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "ClubJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClubJoinRequest_clubId_userId_key"
  ON "ClubJoinRequest"("clubId", "userId");

CREATE INDEX IF NOT EXISTS "ClubJoinRequest_clubId_status_idx"
  ON "ClubJoinRequest"("clubId", "status");

CREATE INDEX IF NOT EXISTS "ClubJoinRequest_userId_idx"
  ON "ClubJoinRequest"("userId");

DO $$ BEGIN
  ALTER TABLE "ClubJoinRequest"
    ADD CONSTRAINT "ClubJoinRequest_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClubJoinRequest"
    ADD CONSTRAINT "ClubJoinRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
