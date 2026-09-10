-- Notificaciones de las Ligas de ClubReads.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LIGA_RESULTADO';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LIGA_CIERRE_PROXIMO';
