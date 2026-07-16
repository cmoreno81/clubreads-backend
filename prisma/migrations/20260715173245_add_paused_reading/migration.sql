-- AlterEnum
ALTER TYPE "ReadingStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "Library" ADD COLUMN     "pauseReason" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3);
