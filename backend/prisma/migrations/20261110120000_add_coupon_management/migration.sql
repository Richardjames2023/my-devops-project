CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE "CouponRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED');

CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "maxDiscountAmount" DECIMAL(12,2),
    "minimumSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "status" "CouponRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders"
ADD COLUMN "couponId" UUID,
ADD COLUMN "couponCode" TEXT,
ADD COLUMN "couponDiscountType" "CouponDiscountType",
ADD COLUMN "couponDiscountValue" DECIMAL(12,2);

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE INDEX "coupons_isActive_startsAt_expiresAt_idx"
ON "coupons"("isActive", "startsAt", "expiresAt");

CREATE UNIQUE INDEX "coupon_redemptions_orderId_key"
ON "coupon_redemptions"("orderId");
CREATE INDEX "coupon_redemptions_couponId_status_idx"
ON "coupon_redemptions"("couponId", "status");
CREATE INDEX "coupon_redemptions_couponId_customerKeyHash_status_idx"
ON "coupon_redemptions"("couponId", "customerKeyHash", "status");
CREATE INDEX "coupon_redemptions_status_expiresAt_idx"
ON "coupon_redemptions"("status", "expiresAt");
CREATE INDEX "orders_couponId_idx" ON "orders"("couponId");

ALTER TABLE "coupons"
ADD CONSTRAINT "coupons_discountValue_positive_check"
CHECK ("discountValue" > 0),
ADD CONSTRAINT "coupons_percentage_discountValue_check"
CHECK ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100),
ADD CONSTRAINT "coupons_maxDiscountAmount_positive_check"
CHECK ("maxDiscountAmount" IS NULL OR "maxDiscountAmount" > 0),
ADD CONSTRAINT "coupons_minimumSubtotal_nonnegative_check"
CHECK ("minimumSubtotal" >= 0),
ADD CONSTRAINT "coupons_usageLimit_positive_check"
CHECK ("usageLimit" IS NULL OR "usageLimit" > 0),
ADD CONSTRAINT "coupons_perCustomerLimit_positive_check"
CHECK ("perCustomerLimit" IS NULL OR "perCustomerLimit" > 0);

ALTER TABLE "coupon_redemptions"
ADD CONSTRAINT "coupon_redemptions_discountAmount_positive_check"
CHECK ("discountAmount" > 0);

ALTER TABLE "coupon_redemptions"
ADD CONSTRAINT "coupon_redemptions_couponId_fkey"
FOREIGN KEY ("couponId") REFERENCES "coupons"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "coupon_redemptions"
ADD CONSTRAINT "coupon_redemptions_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_couponId_fkey"
FOREIGN KEY ("couponId") REFERENCES "coupons"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
