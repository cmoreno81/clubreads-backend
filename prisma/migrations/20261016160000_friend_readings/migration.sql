ALTER TYPE "ClubType" ADD VALUE IF NOT EXISTS 'AMISTADES';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LECTURA_AMISTAD_INVITACION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LECTURA_AMISTAD_ACEPTADA';

CREATE TYPE "FriendReadingInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

CREATE TABLE "FriendReadingInvite" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "bookTitle" TEXT NOT NULL,
    "status" "FriendReadingInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "FriendReadingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FriendReadingInvite_clubId_toUserId_key" ON "FriendReadingInvite"("clubId", "toUserId");
CREATE INDEX "FriendReadingInvite_toUserId_status_idx" ON "FriendReadingInvite"("toUserId", "status");
CREATE INDEX "FriendReadingInvite_fromUserId_idx" ON "FriendReadingInvite"("fromUserId");

ALTER TABLE "FriendReadingInvite" ADD CONSTRAINT "FriendReadingInvite_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendReadingInvite" ADD CONSTRAINT "FriendReadingInvite_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendReadingInvite" ADD CONSTRAINT "FriendReadingInvite_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
