-- El catálogo pagina por deletedAt + createdAt (cursor descendente, ver
-- getGeneralCatalogPage). Sin este índice, cada página fuerza un sort de
-- toda la tabla Book -- cada vez más lento según crece el catálogo con la
-- sincronización del feed de Casa del Libro.
CREATE INDEX IF NOT EXISTS "Book_deletedAt_createdAt_idx" ON "Book"("deletedAt", "createdAt");
