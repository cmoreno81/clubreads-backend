-- Metas opcionales en las lecturas conjuntas, y avisos de metas e invitaciones
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LECTURA_META_PROXIMA';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LECTURA_META_HOY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LECTURA_INVITACION';

CREATE TABLE "ReadingGoal" (
    "id" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "upToChapter" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "remindedDayBeforeAt" TIMESTAMP(3),
    "remindedTodayAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReadingGoal_readingId_upToChapter_key" ON "ReadingGoal"("readingId", "upToChapter");
CREATE INDEX "ReadingGoal_dueDate_idx" ON "ReadingGoal"("dueDate");

ALTER TABLE "ReadingGoal" ADD CONSTRAINT "ReadingGoal_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "Reading"("id") ON DELETE CASCADE ON UPDATE CASCADE;
