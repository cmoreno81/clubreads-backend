ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROGRESO_COMENTARIO';

CREATE TABLE "ProgressComment" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProgressComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProgressComment_libraryId_createdAt_idx" ON "ProgressComment"("libraryId", "createdAt");
CREATE INDEX "ProgressComment_userId_createdAt_idx" ON "ProgressComment"("userId", "createdAt");

ALTER TABLE "ProgressComment" ADD CONSTRAINT "ProgressComment_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressComment" ADD CONSTRAINT "ProgressComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
