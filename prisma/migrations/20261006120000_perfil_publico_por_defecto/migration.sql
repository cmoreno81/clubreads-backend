-- AlterTable
ALTER TABLE "User" ALTER COLUMN "profileVisibility" SET DEFAULT 'PUBLICO';

-- Las cuentas que siguen en el valor por defecto anterior (CLUB) pasan a
-- PUBLICO, igual que lo harán las cuentas nuevas a partir de ahora. No se
-- toca a quien ya eligió PRIVADO explícitamente desde Ajustes.
UPDATE "User" SET "profileVisibility" = 'PUBLICO' WHERE "profileVisibility" = 'CLUB';
