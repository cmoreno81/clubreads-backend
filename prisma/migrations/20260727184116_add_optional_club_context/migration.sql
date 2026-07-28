-- AlterTable
ALTER TABLE "ClubMoodVote" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Clubvision" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "ClubvisionResult" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Reading" ADD COLUMN     "clubId" TEXT;

-- CreateIndex
CREATE INDEX "ClubMoodVote_clubId_idx" ON "ClubMoodVote"("clubId");

-- CreateIndex
CREATE INDEX "Clubvision_clubId_idx" ON "Clubvision"("clubId");

-- CreateIndex
CREATE INDEX "ClubvisionResult_clubId_idx" ON "ClubvisionResult"("clubId");

-- CreateIndex
CREATE INDEX "Reading_clubId_idx" ON "Reading"("clubId");

-- AddForeignKey
ALTER TABLE "ClubMoodVote" ADD CONSTRAINT "ClubMoodVote_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clubvision" ADD CONSTRAINT "Clubvision_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionResult" ADD CONSTRAINT "ClubvisionResult_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
