CREATE TYPE "PromotionBannerPosition" AS ENUM ('HERO', 'TOP', 'BOTTOM');
CREATE TYPE "PromotionBannerStatus" AS ENUM ('DRAFT', 'PAUSED');

CREATE TABLE "promotion_banners" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "mobileImageUrl" TEXT,
  "mobilePublicId" TEXT,
  "position" "PromotionBannerPosition" NOT NULL,
  "targetUrl" TEXT,
  "altText" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" "PromotionBannerStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdByStaffAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotion_banners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotion_banners_creator_fkey" FOREIGN KEY ("createdByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "promotion_banners_valid_period_check" CHECK ("endAt" > "startAt")
);

CREATE TABLE "promotion_banner_defaults" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "position" "PromotionBannerPosition" NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "mobileImageUrl" TEXT,
  "mobilePublicId" TEXT,
  "targetUrl" TEXT,
  "altText" TEXT,
  "updatedByStaffAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotion_banner_defaults_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotion_banner_defaults_updater_fkey" FOREIGN KEY ("updatedByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "promotion_banners_publicId_key" ON "promotion_banners"("publicId");
CREATE UNIQUE INDEX "promotion_banners_mobilePublicId_key" ON "promotion_banners"("mobilePublicId");
CREATE INDEX "promotion_banners_position_status_startAt_endAt_priority_idx" ON "promotion_banners"("position", "status", "startAt", "endAt", "priority");
CREATE INDEX "promotion_banners_createdByStaffAccountId_createdAt_idx" ON "promotion_banners"("createdByStaffAccountId", "createdAt");
CREATE UNIQUE INDEX "promotion_banner_defaults_position_key" ON "promotion_banner_defaults"("position");
CREATE UNIQUE INDEX "promotion_banner_defaults_publicId_key" ON "promotion_banner_defaults"("publicId");
CREATE UNIQUE INDEX "promotion_banner_defaults_mobilePublicId_key" ON "promotion_banner_defaults"("mobilePublicId");
CREATE INDEX "promotion_banner_defaults_updatedByStaffAccountId_updatedAt_idx" ON "promotion_banner_defaults"("updatedByStaffAccountId", "updatedAt");
