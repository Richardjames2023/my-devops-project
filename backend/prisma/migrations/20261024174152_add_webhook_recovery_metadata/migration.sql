-- AlterTable
ALTER TABLE "processed_webhook_events" ADD COLUMN     "amount" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "refundReference" TEXT,
ADD COLUMN     "transactionReference" TEXT;
