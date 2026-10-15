CREATE TABLE "RetoAmistad" (
    "id" TEXT NOT NULL,
    "creadorId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "objetivo" INTEGER NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetoAmistad_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetoAmistadMiembro" (
    "id" TEXT NOT NULL,
    "retoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aceptado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetoAmistadMiembro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RetoAmistad_hasta_idx" ON "RetoAmistad"("hasta");
CREATE UNIQUE INDEX "RetoAmistadMiembro_retoId_userId_key" ON "RetoAmistadMiembro"("retoId", "userId");
CREATE INDEX "RetoAmistadMiembro_userId_idx" ON "RetoAmistadMiembro"("userId");

ALTER TABLE "RetoAmistad" ADD CONSTRAINT "RetoAmistad_creadorId_fkey" FOREIGN KEY ("creadorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetoAmistadMiembro" ADD CONSTRAINT "RetoAmistadMiembro_retoId_fkey" FOREIGN KEY ("retoId") REFERENCES "RetoAmistad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetoAmistadMiembro" ADD CONSTRAINT "RetoAmistadMiembro_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
