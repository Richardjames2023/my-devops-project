-- Durable notification event processing and identity-scoped inbox persistence.
CREATE TYPE "NotificationRecipientType" AS ENUM ('CUSTOMER', 'STAFF');
CREATE TYPE "NotificationCategory" AS ENUM (
  'ACCOUNT', 'ORDER', 'PAYMENT', 'DELIVERY', 'RETURN',
  'REFUND', 'WARRANTY', 'SECURITY', 'INVENTORY', 'STAFF'
);
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD');
CREATE TYPE "NotificationEmailDeliveryStatus" AS ENUM ('QUEUED', 'PROCESSING', 'RETRYING', 'ACCEPTED', 'DEAD');

CREATE TABLE "notification_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "outboxEventId" UUID NOT NULL,
  "recipientType" "NotificationRecipientType" NOT NULL,
  "customerUserId" UUID,
  "staffAccountId" UUID,
  "category" "NotificationCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "actionUrl" TEXT,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_exactly_one_recipient_check" CHECK (
    ("recipientType" = 'CUSTOMER' AND "customerUserId" IS NOT NULL AND "staffAccountId" IS NULL)
    OR
    ("recipientType" = 'STAFF' AND "staffAccountId" IS NOT NULL AND "customerUserId" IS NULL)
  )
);

CREATE TABLE "notification_email_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notificationId" UUID NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "templateData" JSONB NOT NULL,
  "status" "NotificationEmailDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "providerMessageId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipientType" "NotificationRecipientType" NOT NULL,
  "customerUserId" UUID,
  "staffAccountId" UUID,
  "category" "NotificationCategory" NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_exactly_one_recipient_check" CHECK (
    ("recipientType" = 'CUSTOMER' AND "customerUserId" IS NOT NULL AND "staffAccountId" IS NULL)
    OR
    ("recipientType" = 'STAFF' AND "staffAccountId" IS NOT NULL AND "customerUserId" IS NULL)
  )
);

CREATE UNIQUE INDEX "notification_outbox_eventKey_key" ON "notification_outbox"("eventKey");
CREATE INDEX "notification_outbox_status_availableAt_createdAt_idx" ON "notification_outbox"("status", "availableAt", "createdAt");
CREATE INDEX "notification_outbox_status_lockedAt_idx" ON "notification_outbox"("status", "lockedAt");
CREATE INDEX "notification_outbox_aggregateType_aggregateId_createdAt_idx" ON "notification_outbox"("aggregateType", "aggregateId", "createdAt");

CREATE INDEX "notifications_customerUserId_createdAt_idx" ON "notifications"("customerUserId", "createdAt");
CREATE INDEX "notifications_customerUserId_readAt_createdAt_idx" ON "notifications"("customerUserId", "readAt", "createdAt");
CREATE INDEX "notifications_staffAccountId_createdAt_idx" ON "notifications"("staffAccountId", "createdAt");
CREATE INDEX "notifications_staffAccountId_readAt_createdAt_idx" ON "notifications"("staffAccountId", "readAt", "createdAt");
CREATE INDEX "notifications_outboxEventId_idx" ON "notifications"("outboxEventId");
CREATE INDEX "notifications_category_createdAt_idx" ON "notifications"("category", "createdAt");
CREATE UNIQUE INDEX "notifications_outboxEventId_customerUserId_key"
  ON "notifications"("outboxEventId", "customerUserId") WHERE "customerUserId" IS NOT NULL;
CREATE UNIQUE INDEX "notifications_outboxEventId_staffAccountId_key"
  ON "notifications"("outboxEventId", "staffAccountId") WHERE "staffAccountId" IS NOT NULL;

CREATE UNIQUE INDEX "notification_email_deliveries_notificationId_key" ON "notification_email_deliveries"("notificationId");
CREATE INDEX "notification_email_deliveries_status_nextAttemptAt_createdAt_idx" ON "notification_email_deliveries"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "notification_email_deliveries_status_lockedAt_idx" ON "notification_email_deliveries"("status", "lockedAt");
CREATE INDEX "notification_email_deliveries_providerMessageId_idx" ON "notification_email_deliveries"("providerMessageId");

CREATE INDEX "notification_preferences_customerUserId_category_idx" ON "notification_preferences"("customerUserId", "category");
CREATE INDEX "notification_preferences_staffAccountId_category_idx" ON "notification_preferences"("staffAccountId", "category");
CREATE UNIQUE INDEX "notification_preferences_customer_category_key"
  ON "notification_preferences"("customerUserId", "category") WHERE "customerUserId" IS NOT NULL;
CREATE UNIQUE INDEX "notification_preferences_staff_category_key"
  ON "notification_preferences"("staffAccountId", "category") WHERE "staffAccountId" IS NOT NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_outboxEventId_fkey"
  FOREIGN KEY ("outboxEventId") REFERENCES "notification_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_customerUserId_fkey"
  FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_staffAccountId_fkey"
  FOREIGN KEY ("staffAccountId") REFERENCES "staff_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_email_deliveries"
  ADD CONSTRAINT "notification_email_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_customerUserId_fkey"
  FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_staffAccountId_fkey"
  FOREIGN KEY ("staffAccountId") REFERENCES "staff_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
