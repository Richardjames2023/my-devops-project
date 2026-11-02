-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationReason" TEXT,
ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false;
