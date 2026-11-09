-- Email deliveries are an independent channel and may exist without an in-app inbox row.
ALTER TABLE "notification_email_deliveries"
  ALTER COLUMN "notificationId" DROP NOT NULL;

ALTER TABLE "notification_email_deliveries"
  DROP CONSTRAINT "notification_email_deliveries_notificationId_fkey";

ALTER TABLE "notification_email_deliveries"
  ADD CONSTRAINT "notification_email_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
