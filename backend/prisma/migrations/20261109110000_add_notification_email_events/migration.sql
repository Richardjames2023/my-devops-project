-- Persist verified provider events and distinguish accepted from delivered mail.
ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELAYED';
ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';
ALTER TYPE "NotificationEmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "notification_email_deliveries"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "bouncedAt" TIMESTAMP(3),
  ADD COLUMN "complainedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "lastProviderEventType" TEXT;

CREATE TABLE "notification_email_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "providerEventId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "deliveryId" UUID,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_email_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_email_events_providerEventId_key"
  ON "notification_email_events"("providerEventId");
CREATE INDEX "notification_email_events_providerMessageId_receivedAt_idx"
  ON "notification_email_events"("providerMessageId", "receivedAt");
CREATE INDEX "notification_email_events_eventType_receivedAt_idx"
  ON "notification_email_events"("eventType", "receivedAt");

ALTER TABLE "notification_email_events"
  ADD CONSTRAINT "notification_email_events_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "notification_email_deliveries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
