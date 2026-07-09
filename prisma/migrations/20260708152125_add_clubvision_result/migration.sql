/*
  Warnings:

  - The values [PREPARING,VOTING,CLOSED,WINNER_SELECTED,READING,FINISHED] on the enum `ClubvisionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ClubvisionStatus_new" AS ENUM ('SIN_DATOS', 'VOTACION', 'RESULTADOS', 'LECTURA', 'FINALIZADA');
ALTER TABLE "public"."Clubvision" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Clubvision" ALTER COLUMN "status" TYPE "ClubvisionStatus_new" USING ("status"::text::"ClubvisionStatus_new");
ALTER TYPE "ClubvisionStatus" RENAME TO "ClubvisionStatus_old";
ALTER TYPE "ClubvisionStatus_new" RENAME TO "ClubvisionStatus";
DROP TYPE "public"."ClubvisionStatus_old";
ALTER TABLE "Clubvision" ALTER COLUMN "status" SET DEFAULT 'SIN_DATOS';
COMMIT;

-- AlterTable
ALTER TABLE "Clubvision" ALTER COLUMN "status" SET DEFAULT 'SIN_DATOS';

-- CreateTable
CREATE TABLE "ClubvisionResult" (
    "id" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "winnerBookId" TEXT,
    "winnerTitle" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "secondTitle" TEXT,
    "thirdTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubvisionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubvisionResult_edition_key" ON "ClubvisionResult"("edition");

-- CreateIndex
CREATE INDEX "ClubvisionResult_edition_idx" ON "ClubvisionResult"("edition");

-- AddForeignKey
ALTER TABLE "ClubvisionResult" ADD CONSTRAINT "ClubvisionResult_winnerBookId_fkey" FOREIGN KEY ("winnerBookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;
