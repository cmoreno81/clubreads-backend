/*
  Warnings:

  - Made the column `edition` on table `Clubvision` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Clubvision" ALTER COLUMN "edition" SET NOT NULL;
