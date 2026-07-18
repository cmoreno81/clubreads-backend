CREATE TABLE "ReadingCompletion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "isReread" BOOLEAN NOT NULL DEFAULT false,
  "rating" DOUBLE PRECISION,
  "review" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadingCompletion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReadingCompletion" (
  "id", "userId", "bookId", "startedAt", "finishedAt", "isReread",
  "rating", "review", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || library."id",
  library."userId",
  library."bookId",
  library."startedAt",
  library."finishedAt",
  false,
  review."rating",
  review."review",
  library."createdAt",
  library."updatedAt"
FROM "Library" library
LEFT JOIN "Review" review
  ON review."userId" = library."userId"
  AND review."bookId" = library."bookId"
  AND review."deletedAt" IS NULL
WHERE library."status" = 'FINISHED'
  AND library."finishedAt" IS NOT NULL;

UPDATE "Library"
SET "startedAt" = "updatedAt"
WHERE "status" = 'REREADING' AND "startedAt" IS NULL;

CREATE INDEX "ReadingCompletion_userId_finishedAt_idx"
  ON "ReadingCompletion"("userId", "finishedAt");
CREATE INDEX "ReadingCompletion_bookId_finishedAt_idx"
  ON "ReadingCompletion"("bookId", "finishedAt");
CREATE INDEX "ReadingCompletion_isReread_finishedAt_idx"
  ON "ReadingCompletion"("isReread", "finishedAt");

ALTER TABLE "ReadingCompletion"
  ADD CONSTRAINT "ReadingCompletion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReadingCompletion"
  ADD CONSTRAINT "ReadingCompletion_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
