DO $$
DECLARE
  canonical_id TEXT;
  duplicate_id TEXT;
BEGIN
  SELECT "id"
    INTO canonical_id
    FROM "Series"
   WHERE lower(trim("name")) = 'windy city'
   ORDER BY "id"
   LIMIT 1;

  IF canonical_id IS NULL THEN
    SELECT "id"
      INTO canonical_id
      FROM "Series"
     WHERE lower(trim("name")) = 'wyndy city'
     ORDER BY "id"
     LIMIT 1;

    IF canonical_id IS NOT NULL THEN
      UPDATE "Series"
         SET "name" = 'Windy City'
       WHERE "id" = canonical_id;
    END IF;
  END IF;

  IF canonical_id IS NOT NULL THEN
    FOR duplicate_id IN
      SELECT "id"
        FROM "Series"
       WHERE lower(trim("name")) IN ('windy city', 'wyndy city')
         AND "id" <> canonical_id
    LOOP
      UPDATE "Book"
         SET "seriesId" = canonical_id
       WHERE "seriesId" = duplicate_id;

      UPDATE "Series" canonical
         SET "totalBooks" = GREATEST(
           COALESCE(canonical."totalBooks", 0),
           COALESCE(duplicate."totalBooks", 0)
         )
        FROM "Series" duplicate
       WHERE canonical."id" = canonical_id
         AND duplicate."id" = duplicate_id;

      DELETE FROM "Series"
       WHERE "id" = duplicate_id;
    END LOOP;
  END IF;
END $$;
