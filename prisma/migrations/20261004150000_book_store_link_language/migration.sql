-- AlterTable
ALTER TABLE "BookStoreLink" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'es';

-- DropIndex
DROP INDEX "BookStoreLink_bookId_store_format_key";

-- CreateIndex
CREATE UNIQUE INDEX "BookStoreLink_bookId_store_format_language_key" ON "BookStoreLink"("bookId", "store", "format", "language");
