ALTER TABLE "EmergingTalentSubmission" ALTER COLUMN "buyUrl" DROP NOT NULL;
ALTER TABLE "EmergingTalentSubmission" ADD COLUMN "amazonAsin" TEXT;
ALTER TABLE "EmergingTalentSubmission" ADD COLUMN "authorWebUrl" TEXT;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "authorWebUrl" TEXT;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "amazonAsin" TEXT;
