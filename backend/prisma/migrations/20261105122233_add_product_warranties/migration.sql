-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "hasWarranty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyDuration" INTEGER,
ADD COLUMN     "warrantyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "warrantyStartedAt" TIMESTAMP(3),
ADD COLUMN     "warrantyTerms" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "hasWarranty" BOOLEAN,
ADD COLUMN     "warrantyDuration" INTEGER,
ADD COLUMN     "warrantyTerms" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "hasWarranty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyDuration" INTEGER,
ADD COLUMN     "warrantyTerms" TEXT;

-- AlterTable
ALTER TABLE "warranty_claims" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;
