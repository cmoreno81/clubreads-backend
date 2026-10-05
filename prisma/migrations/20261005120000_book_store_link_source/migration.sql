-- AlterTable
ALTER TABLE "BookStoreLink" ADD COLUMN     "pageCheckedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'FEED';
