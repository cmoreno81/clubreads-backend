-- CreateEnum
CREATE TYPE "ClubVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
-- CreateEnum
CREATE TYPE "ClubRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "visibility" "ClubVisibility" NOT NULL DEFAULT 'PRIVATE',
    "inviteCode" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ClubMember" (
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("clubId", "userId")
);
-- CreateIndex
CREATE UNIQUE INDEX "Club_inviteCode_key" ON "Club"("inviteCode");
-- CreateIndex
CREATE INDEX "Club_ownerId_idx" ON "Club"("ownerId");
-- CreateIndex
CREATE INDEX "Club_visibility_idx" ON "Club"("visibility");
-- CreateIndex
CREATE INDEX "ClubMember_userId_idx" ON "ClubMember"("userId");
-- CreateIndex
CREATE INDEX "ClubMember_clubId_role_idx" ON "ClubMember"("clubId", "role");
-- AddForeignKey
ALTER TABLE "Club"
ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClubMember"
ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClubMember"
ADD CONSTRAINT "ClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;