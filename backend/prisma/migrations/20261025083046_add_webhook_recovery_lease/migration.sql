-- AlterTable
ALTER TABLE "processed_webhook_events" ADD COLUMN     "recoveryStartedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryToken" UUID;
