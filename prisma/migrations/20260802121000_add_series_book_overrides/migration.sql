-- Esta migración tolera que los objetos ya se hayan creado manualmente
-- en producción antes de incorporarlos al historial de Prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'SeriesBookOverrideType'
      AND typnamespace = current_schema()::regnamespace
  ) THEN
    CREATE TYPE "SeriesBookOverrideType" AS ENUM (
      'LEIDO_EXTERNO',
      'OMITIDO'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "SeriesBookOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL,
  "posicion" INTEGER NOT NULL,
  "tipo" "SeriesBookOverrideType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SeriesBookOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
"SeriesBookOverride_userId_seriesId_posicion_key"
ON "SeriesBookOverride"("userId", "seriesId", "posicion");

CREATE INDEX IF NOT EXISTS "SeriesBookOverride_userId_seriesId_idx"
ON "SeriesBookOverride"("userId", "seriesId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SeriesBookOverride_userId_fkey'
      AND conrelid = '"SeriesBookOverride"'::regclass
  ) THEN
    ALTER TABLE "SeriesBookOverride"
    ADD CONSTRAINT "SeriesBookOverride_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SeriesBookOverride_seriesId_fkey'
      AND conrelid = '"SeriesBookOverride"'::regclass
  ) THEN
    ALTER TABLE "SeriesBookOverride"
    ADD CONSTRAINT "SeriesBookOverride_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "Series"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
