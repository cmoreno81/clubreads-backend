-- Permite marcar una saga como abandonada directamente (sin depender de que
-- algún tomo individual esté marcado como ABANDONADO en la biblioteca).
ALTER TYPE "HiddenUserSeriesType" ADD VALUE IF NOT EXISTS 'ABANDONADA';
