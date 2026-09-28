-- Premio anual "Libro de Oro": 1ª del ranking Acumulado de Ligas al cerrar
-- el 31 de diciembre. Un registro por año (idempotente vía UNIQUE en "year").

CREATE TABLE IF NOT EXISTS "AnnualBookAward" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnualBookAward_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AnnualBookAward" ADD CONSTRAINT "AnnualBookAward_year_key" UNIQUE ("year");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "AnnualBookAward_userId_idx" ON "AnnualBookAward"("userId");

DO $$ BEGIN
  ALTER TABLE "AnnualBookAward"
    ADD CONSTRAINT "AnnualBookAward_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
