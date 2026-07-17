/*
  Warnings:

  - A unique constraint covering the columns `[edition]` on the table `Clubvision` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Clubvision" ADD COLUMN     "edition" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Clubvision_edition_key" ON "Clubvision"("edition");
