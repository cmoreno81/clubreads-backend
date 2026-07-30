-- Reúne fichas históricas de saga cuyo nombre solo difiere en
-- mayúsculas, tildes o espacios. Los libros conservan sus IDs,
-- bibliotecas, lecturas y portadas.
DO $merge_case_duplicate_series$
DECLARE
  duplicate_group RECORD;
  duplicate_ids TEXT[];
BEGIN
  FOR duplicate_group IN
    SELECT
      ARRAY_AGG(candidate."id" ORDER BY candidate."bookCount" DESC, candidate."id") AS "seriesIds",
      MAX(candidate."totalBooks") AS "maxTotalBooks"
    FROM (
      SELECT
        series."id",
        series."totalBooks",
        LOWER(
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
        ) AS "normalizedName",
        (
          SELECT COUNT(*)::INTEGER
          FROM "Book" book
          WHERE book."seriesId" = series."id"
        ) AS "bookCount"
      FROM "Series" series
    ) candidate
    GROUP BY candidate."normalizedName"
    HAVING COUNT(*) > 1
  LOOP
    duplicate_ids := duplicate_group."seriesIds"[2:];

    UPDATE "Book"
    SET "seriesId" = duplicate_group."seriesIds"[1]
    WHERE "seriesId" = ANY(duplicate_ids);

    UPDATE "Series"
    SET "totalBooks" = duplicate_group."maxTotalBooks"
    WHERE "id" = duplicate_group."seriesIds"[1];

    DELETE FROM "Series"
    WHERE "id" = ANY(duplicate_ids);
  END LOOP;
END
$merge_case_duplicate_series$;
