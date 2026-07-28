-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeClubId" TEXT;

-- CreateIndex
CREATE INDEX "User_activeClubId_idx" ON "User"("activeClubId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeClubId_fkey" FOREIGN KEY ("activeClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;
