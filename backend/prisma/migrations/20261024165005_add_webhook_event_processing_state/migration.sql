-- AlterTable
ALTER TABLE "processed_webhook_events" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PROCESSING';
