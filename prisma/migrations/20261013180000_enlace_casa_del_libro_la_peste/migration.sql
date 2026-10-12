-- Fija a mano la edición de «La peste» (Albert Camus) en Casa del Libro:
-- https://www.casadellibro.com/libro-la-peste/9788435018814/1767002
-- source = 'MANUAL' hace que la sincronización con el feed no la pise.
-- Si el libro no existe en esta base de datos no hace nada.
INSERT INTO "BookStoreLink" (
    "id", "bookId", "store", "format", "language", "source", "ean", "url",
    "confidence", "createdAt", "updatedAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text || b."id"),
    b."id",
    'CASA_DEL_LIBRO',
    'PAPEL'::"StoreFormat",
    'es',
    'MANUAL',
    '9788435018814',
    'https://www.casadellibro.com/libro-la-peste/9788435018814/1767002',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Book" b
JOIN "Author" a ON a."id" = b."authorId"
WHERE b."deletedAt" IS NULL
  AND lower(b."title") = 'la peste'
  AND lower(a."name") = 'albert camus'
ON CONFLICT ("bookId", "store", "format", "language") DO UPDATE SET
    "url" = EXCLUDED."url",
    "ean" = EXCLUDED."ean",
    "source" = 'MANUAL',
    "confidence" = 1,
    "updatedAt" = CURRENT_TIMESTAMP;
