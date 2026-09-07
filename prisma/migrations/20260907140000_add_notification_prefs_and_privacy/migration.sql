-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProfileVisibility" AS ENUM ('CLUB', 'PRIVADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationsDisabled" "NotificationType"[] NOT NULL DEFAULT ARRAY[]::"NotificationType"[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'CLUB';
