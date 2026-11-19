-- CreateEnum
CREATE TYPE "ChatAiGenerationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "chat_ai_generations" (
    "id" UUID NOT NULL,
    "customer_message_id" UUID NOT NULL,
    "status" "ChatAiGenerationStatus" NOT NULL DEFAULT 'PROCESSING',
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "failure_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_ai_generations_customer_message_id_key" ON "chat_ai_generations"("customer_message_id");

-- CreateIndex
CREATE INDEX "chat_ai_generations_status_lease_expires_at_idx" ON "chat_ai_generations"("status", "lease_expires_at");

-- RenameForeignKey
ALTER TABLE "promotion_banner_defaults" RENAME CONSTRAINT "promotion_banner_defaults_updater_fkey" TO "promotion_banner_defaults_updatedByStaffAccountId_fkey";

-- RenameForeignKey
ALTER TABLE "promotion_banners" RENAME CONSTRAINT "promotion_banners_creator_fkey" TO "promotion_banners_createdByStaffAccountId_fkey";

-- AddForeignKey
ALTER TABLE "chat_ai_generations" ADD CONSTRAINT "chat_ai_generations_customer_message_id_fkey" FOREIGN KEY ("customer_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
