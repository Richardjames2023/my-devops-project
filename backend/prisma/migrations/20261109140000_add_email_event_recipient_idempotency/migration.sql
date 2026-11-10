-- Provide idempotency for email-only deliveries that have no inbox row.
ALTER TABLE "notification_email_deliveries"
  ADD COLUMN "eventRecipientKey" TEXT;

CREATE UNIQUE INDEX "notification_email_deliveries_eventRecipientKey_key"
  ON "notification_email_deliveries"("eventRecipientKey");
