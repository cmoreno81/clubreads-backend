-- CreateEnum
CREATE TYPE "ClubvisionStatus" AS ENUM ('PREPARING', 'VOTING', 'CLOSED', 'WINNER_SELECTED', 'READING', 'FINISHED');

-- CreateTable
CREATE TABLE "Clubvision" (
    "id" TEXT NOT NULL,
    "status" "ClubvisionStatus" NOT NULL DEFAULT 'PREPARING',
    "title" TEXT,
    "message" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "winnerBookId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clubvision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubvisionCandidate" (
    "id" TEXT NOT NULL,
    "clubvisionId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubvisionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubvisionVote" (
    "id" TEXT NOT NULL,
    "clubvisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubvisionVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubvisionCandidate_clubvisionId_idx" ON "ClubvisionCandidate"("clubvisionId");

-- CreateIndex
CREATE INDEX "ClubvisionCandidate_bookId_idx" ON "ClubvisionCandidate"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubvisionCandidate_clubvisionId_bookId_key" ON "ClubvisionCandidate"("clubvisionId", "bookId");

-- CreateIndex
CREATE INDEX "ClubvisionVote_clubvisionId_idx" ON "ClubvisionVote"("clubvisionId");

-- CreateIndex
CREATE INDEX "ClubvisionVote_userId_idx" ON "ClubvisionVote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubvisionVote_clubvisionId_userId_candidateId_key" ON "ClubvisionVote"("clubvisionId", "userId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubvisionVote_clubvisionId_userId_position_key" ON "ClubvisionVote"("clubvisionId", "userId", "position");

-- AddForeignKey
ALTER TABLE "Clubvision" ADD CONSTRAINT "Clubvision_winnerBookId_fkey" FOREIGN KEY ("winnerBookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionCandidate" ADD CONSTRAINT "ClubvisionCandidate_clubvisionId_fkey" FOREIGN KEY ("clubvisionId") REFERENCES "Clubvision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionCandidate" ADD CONSTRAINT "ClubvisionCandidate_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionVote" ADD CONSTRAINT "ClubvisionVote_clubvisionId_fkey" FOREIGN KEY ("clubvisionId") REFERENCES "Clubvision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionVote" ADD CONSTRAINT "ClubvisionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubvisionVote" ADD CONSTRAINT "ClubvisionVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClubvisionCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
