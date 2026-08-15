-- AlterTable: añadir isFavorite a Library
ALTER TABLE "Library" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- Índice para consultas de favoritos por usuario
CREATE INDEX IF NOT EXISTS "Library_userId_isFavorite_idx" ON "Library"("userId", "isFavorite");
