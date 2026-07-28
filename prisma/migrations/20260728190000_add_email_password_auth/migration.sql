-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay correos duplicados al ignorar mayúsculas y espacios';
  END IF;
END $$;

UPDATE "User" SET "email" = lower(btrim("email"));

ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordSetAt" TIMESTAMP(3),
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "AuthCodePurpose" AS ENUM ('ACTIVATE', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "AuthCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "AuthCodePurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthCode_userId_purpose_createdAt_idx"
  ON "AuthCode"("userId", "purpose", "createdAt");
CREATE INDEX "AuthCode_expiresAt_idx" ON "AuthCode"("expiresAt");
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key"
  ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx"
  ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthCode"
  ADD CONSTRAINT "AuthCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
