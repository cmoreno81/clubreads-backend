CREATE TYPE "ClubvisionKind" AS ENUM ('MONTHLY', 'WELCOME');

ALTER TABLE "Clubvision"
ADD COLUMN "kind" "ClubvisionKind" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "votingEndsAt" TIMESTAMP(3),
ADD COLUMN "resultsEndsAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Clubvision_one_welcome_per_club"
ON "Clubvision"("clubId")
WHERE "kind" = 'WELCOME';
