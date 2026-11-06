CREATE TYPE "ProductReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "product_reviews" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT NOT NULL,
    "status" "ProductReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_reviews_userId_productId_key"
ON "product_reviews"("userId", "productId");

CREATE INDEX "product_reviews_productId_status_createdAt_idx"
ON "product_reviews"("productId", "status", "createdAt");

CREATE INDEX "product_reviews_userId_idx"
ON "product_reviews"("userId");

CREATE INDEX "product_reviews_orderItemId_idx"
ON "product_reviews"("orderItemId");

ALTER TABLE "product_reviews"
ADD CONSTRAINT "product_reviews_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_reviews"
ADD CONSTRAINT "product_reviews_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_reviews"
ADD CONSTRAINT "product_reviews_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_reviews"
ADD CONSTRAINT "product_reviews_rating_check"
CHECK ("rating" >= 1 AND "rating" <= 5);

ALTER TABLE "product_reviews"
ADD CONSTRAINT "product_reviews_comment_length_check"
CHECK (char_length(trim("comment")) BETWEEN 3 AND 5000);
