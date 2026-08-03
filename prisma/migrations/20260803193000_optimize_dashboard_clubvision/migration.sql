CREATE INDEX "Library_bookId_status_idx" ON "Library"("bookId", "status");

CREATE INDEX "Reading_clubId_type_status_idx" ON "Reading"("clubId", "type", "status");
