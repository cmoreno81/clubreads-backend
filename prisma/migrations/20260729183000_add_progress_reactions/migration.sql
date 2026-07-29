CREATE TABLE "ProgressReaction" (
  "id" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reaction" "ReactionType" NOT NULL DEFAULT 'LIKE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgressReaction_libraryId_userId_key"
ON "ProgressReaction"("libraryId", "userId");

CREATE INDEX "ProgressReaction_userId_idx"
ON "ProgressReaction"("userId");

ALTER TABLE "ProgressReaction"
ADD CONSTRAINT "ProgressReaction_libraryId_fkey"
FOREIGN KEY ("libraryId") REFERENCES "Library"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgressReaction"
ADD CONSTRAINT "ProgressReaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
