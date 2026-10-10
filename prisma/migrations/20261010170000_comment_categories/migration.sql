-- Nombre de categoría en cada comentario y categorías personalizadas por usuaria
ALTER TABLE "Comment" ADD COLUMN "typeLabel" TEXT;
ALTER TABLE "User" ADD COLUMN "commentCategories" JSONB;
