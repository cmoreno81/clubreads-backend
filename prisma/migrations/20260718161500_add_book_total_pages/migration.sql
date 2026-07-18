ALTER TABLE "Book" ADD COLUMN "totalPages" INTEGER;

ALTER TABLE "Book"
ADD CONSTRAINT "Book_totalPages_check"
CHECK ("totalPages" IS NULL OR "totalPages" > 0);
