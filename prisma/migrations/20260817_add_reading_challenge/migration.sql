-- CreateTable
CREATE TABLE "ReadingChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReadingChallenge_userId_year_key" ON "ReadingChallenge"("userId", "year");

-- CreateIndex
CREATE INDEX "ReadingChallenge_year_idx" ON "ReadingChallenge"("year");

-- AddForeignKey
ALTER TABLE "ReadingChallenge" ADD CONSTRAINT "ReadingChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
