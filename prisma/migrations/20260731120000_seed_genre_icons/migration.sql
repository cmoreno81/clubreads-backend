-- Migración: Poblar iconos de géneros conocidos (incluyendo el nuevo género Infantil)
-- Los géneros se crean vía upsert desde la app, esta migración solo rellena
-- el campo icon en los que ya existen y añade Infantil si no estaba.

-- Actualizar iconos de géneros existentes
UPDATE "Genre" SET "icon" = '🐉' WHERE LOWER("name") = 'fantasía'    AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🌹' WHERE LOWER("name") = 'romantasy'   AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '💕' WHERE LOWER("name") = 'romance'     AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🔪' WHERE LOWER("name") = 'thriller'    AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🖤' WHERE LOWER("name") = 'dark romance' AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🎓' WHERE LOWER("name") = 'dark academia' AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🎭' WHERE LOWER("name") = 'drama'       AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '📜' WHERE LOWER("name") = 'clásicos'    AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🌇' WHERE LOWER("name") = 'distopía'    AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🏙️' WHERE LOWER("name") IN ('novela contemporánea', 'contemporánea') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🏰' WHERE LOWER("name") IN ('novela histórica', 'histórica') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🚀' WHERE LOWER("name") IN ('ciencia ficción', 'ciencia ficcion') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '👻' WHERE LOWER("name") = 'terror'      AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🕵️' WHERE LOWER("name") IN ('novela negra', 'thriller negro') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '💬' WHERE LOWER("name") IN ('cómic', 'comic') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🧠' WHERE LOWER("name") IN ('no ficción', 'no ficcion') AND ("icon" IS NULL OR "icon" = '');
UPDATE "Genre" SET "icon" = '🎈' WHERE LOWER("name") = 'infantil'    AND ("icon" IS NULL OR "icon" = '');

-- Insertar Infantil si no existe aún (por si ningún libro lo ha creado todavía)
INSERT INTO "Genre" ("id", "name", "icon")
VALUES (gen_random_uuid()::text, 'Infantil', '🎈')
ON CONFLICT ("name") DO UPDATE SET "icon" = EXCLUDED."icon"
WHERE "Genre"."icon" IS NULL OR "Genre"."icon" = '';
