-- Ligas: solo puntúan los libros que se han leído "dentro" de la app.
-- Las lecturas pasadas marcadas de golpe o importadas no deben dar puntos.

ALTER TABLE "ReadingCompletion"
  ADD COLUMN IF NOT EXISTS "trackedInApp" BOOLEAN NOT NULL DEFAULT false;

-- Backfill aproximado: consideramos leída en la app la lectura que se empezó
-- con antelación (>12 h antes de registrar el final) y cuya fecha de fin no
-- está retrotraída (lo contrario apunta a una importación o a un libro
-- pasado marcado como terminado sin haberlo seguido en la app).
UPDATE "ReadingCompletion"
SET "trackedInApp" = true
WHERE "startedAt" IS NOT NULL
  AND "startedAt" < "createdAt" - INTERVAL '12 hours'
  AND "finishedAt" >= "createdAt" - INTERVAL '3 days';
