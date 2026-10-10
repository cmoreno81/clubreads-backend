-- Foto adjunta a los comentarios de lectura
ALTER TABLE "Comment" ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imagePublicId" TEXT;
