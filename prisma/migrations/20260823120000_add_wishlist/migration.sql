-- Un intento anterior puede haber dejado creado el enum antes de que Prisma
-- registrase la migración completa. Se conserva ese tipo y sus datos.
DO $$
BEGIN
    CREATE TYPE "WishlistFormat" AS ENUM ('PHYSICAL', 'DIGITAL', 'AUDIOBOOK');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE "WishlistPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WishlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "coverUrl" TEXT,
    "isbn" TEXT,
    "format" "WishlistFormat" NOT NULL DEFAULT 'PHYSICAL',
    "priority" "WishlistPriority" NOT NULL DEFAULT 'MEDIUM',
    "price" DOUBLE PRECISION,
    "releaseDate" TIMESTAMP(3),
    "plannedMonth" TIMESTAMP(3),
    "note" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- La tabla pudo quedar creada parcialmente por un despliegue anterior.
ALTER TABLE "WishlistItem"
ADD COLUMN IF NOT EXISTS "purchasedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WishlistItem_userId_idx" ON "WishlistItem"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WishlistItem_userId_releaseDate_idx" ON "WishlistItem"("userId", "releaseDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WishlistItem_userId_purchasedAt_idx" ON "WishlistItem"("userId", "purchasedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WishlistItem_bookId_idx" ON "WishlistItem"("bookId");

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_bookId_fkey"
    FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
