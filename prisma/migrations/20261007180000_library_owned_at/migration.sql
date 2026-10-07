-- AlterTable
ALTER TABLE "Library" ADD COLUMN "ownedAt" TIMESTAMP(3);

-- Los libros que ya estaban marcados "ya lo tengo" antes de guardar la fecha
-- cuentan desde su última modificación.
UPDATE "Library" SET "ownedAt" = "updatedAt" WHERE "owned" = true AND "ownedAt" IS NULL;
