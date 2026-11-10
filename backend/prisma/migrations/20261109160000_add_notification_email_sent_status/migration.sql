ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENT';

ALTER TABLE "notification_email_deliveries"
  ADD COLUMN "sentAt" TIMESTAMP(3);
