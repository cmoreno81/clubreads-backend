CREATE TABLE "HiddenUserSeries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenUserSeries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HiddenUserSeries_userId_seriesId_key"
ON "HiddenUserSeries"("userId", "seriesId");

CREATE INDEX "HiddenUserSeries_userId_idx" ON "HiddenUserSeries"("userId");
CREATE INDEX "HiddenUserSeries_seriesId_idx" ON "HiddenUserSeries"("seriesId");

ALTER TABLE "HiddenUserSeries"
ADD CONSTRAINT "HiddenUserSeries_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiddenUserSeries"
ADD CONSTRAINT "HiddenUserSeries_seriesId_fkey"
FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
