CREATE TYPE "EmergingTalentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "EmergingTalentSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "EmergingTalentStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "authorProfile" TEXT,
    "genre" TEXT NOT NULL,
    "extraGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'es',
    "pages" INTEGER,
    "spicyLevel" INTEGER NOT NULL DEFAULT 0,
    "tropes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synopsis" TEXT NOT NULL,
    "authorNote" TEXT,
    "buyUrl" TEXT NOT NULL,
    "coverUrl" TEXT NOT NULL,
    "coverPublicId" TEXT,
    "termsVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedBookId" TEXT,

    CONSTRAINT "EmergingTalentSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmergingTalentSubmission_approvedBookId_key" ON "EmergingTalentSubmission"("approvedBookId");
CREATE INDEX "EmergingTalentSubmission_status_createdAt_idx" ON "EmergingTalentSubmission"("status", "createdAt");
CREATE INDEX "EmergingTalentSubmission_contactEmail_idx" ON "EmergingTalentSubmission"("contactEmail");
