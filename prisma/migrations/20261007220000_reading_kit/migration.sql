-- CreateTable
CREATE TABLE "ReadingKit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingKit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingKit_userId_idx" ON "ReadingKit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingKit_userId_bookId_key" ON "ReadingKit"("userId", "bookId");

-- AddForeignKey
ALTER TABLE "ReadingKit" ADD CONSTRAINT "ReadingKit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingKit" ADD CONSTRAINT "ReadingKit_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
