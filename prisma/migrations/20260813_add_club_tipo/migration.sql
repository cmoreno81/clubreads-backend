-- CreateEnum
CREATE TYPE "ClubType" AS ENUM ('SOCIAL', 'PERSONAL');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN "tipo" "ClubType" NOT NULL DEFAULT 'SOCIAL';
