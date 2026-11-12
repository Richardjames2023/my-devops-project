CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wishlist_items_userId_productId_key"
    ON "wishlist_items"("userId", "productId");
CREATE INDEX "wishlist_items_userId_createdAt_idx"
    ON "wishlist_items"("userId", "createdAt");
CREATE INDEX "wishlist_items_productId_idx"
    ON "wishlist_items"("productId");

ALTER TABLE "wishlist_items"
    ADD CONSTRAINT "wishlist_items_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wishlist_items"
    ADD CONSTRAINT "wishlist_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
