CREATE TABLE "WishlistReservation" (
    "id" TEXT NOT NULL,
    "wishlistItemId" TEXT NOT NULL,
    "reservedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WishlistReservation_wishlistItemId_key" ON "WishlistReservation"("wishlistItemId");
CREATE INDEX "WishlistReservation_reservedById_idx" ON "WishlistReservation"("reservedById");

ALTER TABLE "WishlistReservation" ADD CONSTRAINT "WishlistReservation_wishlistItemId_fkey" FOREIGN KEY ("wishlistItemId") REFERENCES "WishlistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistReservation" ADD CONSTRAINT "WishlistReservation_reservedById_fkey" FOREIGN KEY ("reservedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
