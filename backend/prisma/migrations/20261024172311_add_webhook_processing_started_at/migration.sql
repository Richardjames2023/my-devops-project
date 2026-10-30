-- AlterTable
ALTER TABLE "processed_webhook_events" ADD COLUMN     "processingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
