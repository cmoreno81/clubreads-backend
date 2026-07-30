-- Reúne fichas históricas de saga cuyo nombre solo difiere en
-- mayúsculas, tildes o espacios. Los libros conservan sus IDs,
-- bibliotecas, lecturas y portadas.
CREATE TEMP TABLE "_SeriesCaseMerge" ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    series."id",
    FIRST_VALUE(series."id") OVER (
      PARTITION BY LOWER(
        REGEXP_REPLACE(
          TRANSLATE(
            TRIM(series."name"),
            'ÁÉÍÓÚÜÑáéíóúüñ',
            'AEIOUUNaeiouun'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
      ORDER BY (
        SELECT COUNT(*)
        FROM "Book" book
        WHERE book."seriesId" = series."id"
      ) DESC, series."id"
    ) AS "keeperId",
    MAX(series."totalBooks") OVER (
      PARTITION BY LOWER(
        REGEXP_REPLACE(
          TRANSLATE(
            TRIM(series."name"),
            'ÁÉÍÓÚÜÑáéíóúüñ',
            'AEIOUUNaeiouun'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS "maxTotalBooks"
  FROM "Series" series
)
SELECT
  "id" AS "duplicateId",
  "keeperId",
  "maxTotalBooks"
FROM ranked
WHERE "id" <> "keeperId";

UPDATE "Book" book
SET "seriesId" = merge."keeperId"
FROM "_SeriesCaseMerge" merge
WHERE book."seriesId" = merge."duplicateId";

UPDATE "Series" series
SET "totalBooks" = merge."maxTotalBooks"
FROM (
  SELECT "keeperId", MAX("maxTotalBooks") AS "maxTotalBooks"
  FROM "_SeriesCaseMerge"
  GROUP BY "keeperId"
) merge
WHERE series."id" = merge."keeperId";

DELETE FROM "Series" series
USING "_SeriesCaseMerge" merge
WHERE series."id" = merge."duplicateId";
