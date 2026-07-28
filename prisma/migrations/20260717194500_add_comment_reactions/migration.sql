CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'AGREE', 'ANGRY', 'FUNNY');

ALTER TABLE "Like"
ADD COLUMN "reaction" "ReactionType" NOT NULL DEFAULT 'LIKE';
