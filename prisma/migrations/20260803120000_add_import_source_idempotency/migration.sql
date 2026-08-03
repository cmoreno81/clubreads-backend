CREATE TYPE "ImportSource" AS ENUM ('GOODREADS', 'BOOKMORY');

CREATE TABLE "ImportRowReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceRowId" TEXT,
    "bookId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportRowReceipt_userId_source_idempotencyKey_key"
ON "ImportRowReceipt"("userId", "source", "idempotencyKey");

CREATE INDEX "ImportRowReceipt_bookId_idx" ON "ImportRowReceipt"("bookId");

ALTER TABLE "ImportRowReceipt"
ADD CONSTRAINT "ImportRowReceipt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
