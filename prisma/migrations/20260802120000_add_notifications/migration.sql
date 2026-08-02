CREATE TYPE "NotificationType" AS ENUM (
  'CLUBVISION_ABIERTA',
  'CLUBVISION_RESULTADOS',
  'LECTURA_NUEVA',
  'COMENTARIO_LECTURA',
  'LIBRO_TERMINADO',
  'LIBRO_NUEVO_BIBLIOTECA',
  'NUEVA_MIEMBRO'
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tipo" "NotificationType" NOT NULL,
  "titulo" TEXT NOT NULL,
  "mensaje" TEXT NOT NULL,
  "leida" BOOLEAN NOT NULL DEFAULT false,
  "clubId" TEXT,
  "bookId" TEXT,
  "extra" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_leida_idx"
ON "Notification"("userId", "leida");

CREATE INDEX "Notification_userId_createdAt_idx"
ON "Notification"("userId", "createdAt");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
