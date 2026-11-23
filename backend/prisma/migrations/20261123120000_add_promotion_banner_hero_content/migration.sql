ALTER TABLE "promotion_banners"
  ADD COLUMN "eyebrow" TEXT,
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "badgeText" TEXT,
  ADD COLUMN "primaryCtaLabel" TEXT,
  ADD COLUMN "primaryCtaUrl" TEXT,
  ADD COLUMN "secondaryCtaLabel" TEXT,
  ADD COLUMN "secondaryCtaUrl" TEXT;

ALTER TABLE "promotion_banner_defaults"
  ADD COLUMN "eyebrow" TEXT,
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "badgeText" TEXT,
  ADD COLUMN "primaryCtaLabel" TEXT,
  ADD COLUMN "primaryCtaUrl" TEXT,
  ADD COLUMN "secondaryCtaLabel" TEXT,
  ADD COLUMN "secondaryCtaUrl" TEXT;
