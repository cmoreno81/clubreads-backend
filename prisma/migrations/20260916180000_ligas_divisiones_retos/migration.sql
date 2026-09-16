-- Divisiones con ascenso/descenso, reto semanal y aviso de racha en riesgo.

DO $$ BEGIN
  CREATE TYPE "RankingDivision" AS ENUM ('BRONCE', 'PLATA', 'ORO', 'PLATINO', 'DIAMANTE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RankingParticipation"
  ADD COLUMN IF NOT EXISTS "division" "RankingDivision" NOT NULL DEFAULT 'BRONCE';

ALTER TABLE "RankingSeasonResult"
  ADD COLUMN IF NOT EXISTS "division" "RankingDivision" NOT NULL DEFAULT 'BRONCE';

ALTER TYPE "RankingEventType" ADD VALUE IF NOT EXISTS 'WEEKLY_CHALLENGE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LIGA_RACHA_EN_RIESGO';
