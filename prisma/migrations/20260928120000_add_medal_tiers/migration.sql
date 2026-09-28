-- Nuevas medallas de Liga: racha perfecta de check-in, todas las divisiones,
-- bicampeona, hattrick, remontada y Libro del Año.
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'RACHA_PERFECTA';
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'POLIFACETICA';
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'BICAMPEONA';
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'HATTRICK';
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'REMONTADA';
ALTER TYPE "MedalTier" ADD VALUE IF NOT EXISTS 'LIBRO_DEL_ANIO';
