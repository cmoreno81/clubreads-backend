/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Club` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `Club` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
