-- CreateEnum
CREATE TYPE "StoreFormat" AS ENUM ('PAPEL', 'EBOOK', 'AUDIO');

-- CreateTable
CREATE TABLE "BookStoreLink" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "store" TEXT NOT NULL DEFAULT 'CASA_DEL_LIBRO',
    "format" "StoreFormat" NOT NULL,
    "ean" TEXT,
    "url" TEXT NOT NULL,
    "feedTitle" TEXT,
    "feedAuthor" TEXT,
    "confidence" DOUBLE PRECISION,
    "stockStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookStoreLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookStoreLink_bookId_idx" ON "BookStoreLink"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "BookStoreLink_bookId_store_format_key" ON "BookStoreLink"("bookId", "store", "format");

-- AddForeignKey
ALTER TABLE "BookStoreLink" ADD CONSTRAINT "BookStoreLink_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
