CREATE TYPE "ReactionType" AS ENUM (
  'LIKE',
  'AGREE',
  'ANGRY',
  'FUNNY',
  'THUMBS_UP',
  'CRY',
  'WOW',
  'SWEAR',
  'CLAP'
);

ALTER TABLE "Like"
ADD COLUMN "reaction" "ReactionType" NOT NULL DEFAULT 'LIKE';
