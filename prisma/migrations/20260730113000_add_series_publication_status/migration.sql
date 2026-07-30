CREATE TYPE "SeriesPublicationStatus" AS ENUM ('UNKNOWN', 'ONGOING', 'COMPLETED');

ALTER TABLE "Series"
ADD COLUMN "publicationStatus" "SeriesPublicationStatus" NOT NULL DEFAULT 'UNKNOWN';
