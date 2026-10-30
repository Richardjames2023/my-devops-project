-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhook_events_eventKey_key" ON "processed_webhook_events"("eventKey");

-- CreateIndex
CREATE INDEX "processed_webhook_events_eventType_processedAt_idx" ON "processed_webhook_events"("eventType", "processedAt");
