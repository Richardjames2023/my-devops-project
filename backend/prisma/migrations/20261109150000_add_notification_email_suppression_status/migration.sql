ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';

ALTER TABLE "notification_email_deliveries"
  ADD COLUMN "suppressedAt" TIMESTAMP(3);
