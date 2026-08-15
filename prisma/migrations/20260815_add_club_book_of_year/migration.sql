CREATE TYPE "ClubBookOfYearStatus" AS ENUM ('PREPARING', 'QUALIFYING', 'ROUND_PENDING', 'ROUND_OPEN', 'TIEBREAK', 'FINISHED', 'CANCELLED');
CREATE TYPE "ClubBookOfYearPhase" AS ENUM ('QUALIFYING', 'QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'TIEBREAK');
CREATE TYPE "ClubBookOfYearRoundStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED');
ALTER TYPE "NotificationType" ADD VALUE 'CLUB_BOOK_OF_YEAR';

CREATE TABLE "ClubBookOfYearEdition" (
  "id" TEXT NOT NULL, "clubId" TEXT NOT NULL, "year" INTEGER NOT NULL,
  "status" "ClubBookOfYearStatus" NOT NULL DEFAULT 'PREPARING', "bracketSize" INTEGER,
  "winnerCandidateId" TEXT, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubBookOfYearEdition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubBookOfYearCandidate" (
  "id" TEXT NOT NULL, "editionId" TEXT NOT NULL, "bookId" TEXT NOT NULL, "seed" INTEGER, "qualified" BOOLEAN NOT NULL DEFAULT false, "tiebreakEligible" BOOLEAN NOT NULL DEFAULT false,
  "titleSnapshot" TEXT NOT NULL, "coverUrlSnapshot" TEXT, "authorNameSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubBookOfYearCandidate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubBookOfYearRound" (
  "id" TEXT NOT NULL, "editionId" TEXT NOT NULL, "phase" "ClubBookOfYearPhase" NOT NULL,
  "sequence" INTEGER NOT NULL, "status" "ClubBookOfYearRoundStatus" NOT NULL DEFAULT 'PENDING',
  "openedAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubBookOfYearRound_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubBookOfYearDuel" (
  "id" TEXT NOT NULL, "roundId" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "candidateAId" TEXT NOT NULL, "candidateBId" TEXT NOT NULL, "winnerCandidateId" TEXT, "tied" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ClubBookOfYearDuel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubBookOfYearQualifyingVote" (
  "id" TEXT NOT NULL, "editionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "candidateId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubBookOfYearQualifyingVote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubBookOfYearDuelVote" (
  "id" TEXT NOT NULL, "duelId" TEXT NOT NULL, "userId" TEXT NOT NULL, "candidateId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubBookOfYearDuelVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClubBookOfYearEdition_clubId_year_key" ON "ClubBookOfYearEdition"("clubId", "year");
CREATE INDEX "ClubBookOfYearEdition_clubId_status_idx" ON "ClubBookOfYearEdition"("clubId", "status");
CREATE INDEX "ClubBookOfYearEdition_year_idx" ON "ClubBookOfYearEdition"("year");
CREATE UNIQUE INDEX "ClubBookOfYearCandidate_editionId_bookId_key" ON "ClubBookOfYearCandidate"("editionId", "bookId");
CREATE UNIQUE INDEX "ClubBookOfYearCandidate_id_editionId_key" ON "ClubBookOfYearCandidate"("id", "editionId");
CREATE INDEX "ClubBookOfYearCandidate_bookId_idx" ON "ClubBookOfYearCandidate"("bookId");
CREATE INDEX "ClubBookOfYearCandidate_editionId_seed_idx" ON "ClubBookOfYearCandidate"("editionId", "seed");
CREATE UNIQUE INDEX "ClubBookOfYearRound_editionId_sequence_key" ON "ClubBookOfYearRound"("editionId", "sequence");
CREATE INDEX "ClubBookOfYearRound_editionId_phase_status_idx" ON "ClubBookOfYearRound"("editionId", "phase", "status");
CREATE UNIQUE INDEX "ClubBookOfYearDuel_roundId_position_key" ON "ClubBookOfYearDuel"("roundId", "position");
CREATE INDEX "ClubBookOfYearDuel_roundId_idx" ON "ClubBookOfYearDuel"("roundId");
CREATE UNIQUE INDEX "ClubBookOfYearQualifyingVote_editionId_userId_candidateId_key" ON "ClubBookOfYearQualifyingVote"("editionId", "userId", "candidateId");
CREATE INDEX "ClubBookOfYearQualifyingVote_editionId_candidateId_idx" ON "ClubBookOfYearQualifyingVote"("editionId", "candidateId");
CREATE INDEX "ClubBookOfYearQualifyingVote_userId_idx" ON "ClubBookOfYearQualifyingVote"("userId");
CREATE UNIQUE INDEX "ClubBookOfYearDuelVote_duelId_userId_key" ON "ClubBookOfYearDuelVote"("duelId", "userId");
CREATE INDEX "ClubBookOfYearDuelVote_duelId_candidateId_idx" ON "ClubBookOfYearDuelVote"("duelId", "candidateId");
CREATE INDEX "ClubBookOfYearDuelVote_userId_idx" ON "ClubBookOfYearDuelVote"("userId");

ALTER TABLE "ClubBookOfYearEdition" ADD CONSTRAINT "ClubBookOfYearEdition_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearCandidate" ADD CONSTRAINT "ClubBookOfYearCandidate_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "ClubBookOfYearEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearCandidate" ADD CONSTRAINT "ClubBookOfYearCandidate_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearEdition" ADD CONSTRAINT "ClubBookOfYearEdition_winnerCandidateId_fkey" FOREIGN KEY ("winnerCandidateId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearRound" ADD CONSTRAINT "ClubBookOfYearRound_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "ClubBookOfYearEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuel" ADD CONSTRAINT "ClubBookOfYearDuel_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ClubBookOfYearRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuel" ADD CONSTRAINT "ClubBookOfYearDuel_candidateAId_fkey" FOREIGN KEY ("candidateAId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuel" ADD CONSTRAINT "ClubBookOfYearDuel_candidateBId_fkey" FOREIGN KEY ("candidateBId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuel" ADD CONSTRAINT "ClubBookOfYearDuel_winnerCandidateId_fkey" FOREIGN KEY ("winnerCandidateId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearQualifyingVote" ADD CONSTRAINT "ClubBookOfYearQualifyingVote_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "ClubBookOfYearEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearQualifyingVote" ADD CONSTRAINT "ClubBookOfYearQualifyingVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearQualifyingVote" ADD CONSTRAINT "ClubBookOfYearQualifyingVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuelVote" ADD CONSTRAINT "ClubBookOfYearDuelVote_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "ClubBookOfYearDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuelVote" ADD CONSTRAINT "ClubBookOfYearDuelVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubBookOfYearDuelVote" ADD CONSTRAINT "ClubBookOfYearDuelVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClubBookOfYearCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
