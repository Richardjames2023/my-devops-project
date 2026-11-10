-- One Resend message ID must correlate to exactly one local delivery.
DROP INDEX IF EXISTS "notification_email_deliveries_providerMessageId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "notification_email_deliveries_providerMessageId_key"
  ON "notification_email_deliveries"("providerMessageId");
