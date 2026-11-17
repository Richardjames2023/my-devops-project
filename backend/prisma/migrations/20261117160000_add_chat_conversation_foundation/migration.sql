CREATE TYPE "ChatConversationStatus" AS ENUM (
  'BOT_ACTIVE',
  'WAITING_FOR_AGENT',
  'HUMAN_ACTIVE',
  'CLOSED'
);

CREATE TYPE "ChatSenderType" AS ENUM (
  'CUSTOMER',
  'BOT',
  'AGENT',
  'SYSTEM'
);

CREATE TYPE "ChatEventType" AS ENUM (
  'HANDOFF_REQUESTED',
  'AGENT_ASSIGNED',
  'AGENT_ACCEPTED',
  'CONVERSATION_CLOSED'
);

CREATE TABLE "chat_conversations" (
  "id" UUID NOT NULL,
  "customer_user_id" UUID,
  "guest_session_id" UUID,
  "status" "ChatConversationStatus" NOT NULL DEFAULT 'BOT_ACTIVE',
  "assigned_agent_id" UUID,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_conversations_single_owner_check"
    CHECK (NOT ("customer_user_id" IS NOT NULL AND "guest_session_id" IS NOT NULL))
);

CREATE TABLE "chat_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sender_type" "ChatSenderType" NOT NULL,
  "sender_agent_id" UUID,
  "content" TEXT NOT NULL,
  "client_message_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_events" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "event_type" "ChatEventType" NOT NULL,
  "previous_status" "ChatConversationStatus",
  "new_status" "ChatConversationStatus",
  "actor_agent_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_messages_conversation_id_sender_type_client_message_id_key"
  ON "chat_messages"("conversation_id", "sender_type", "client_message_id");

CREATE INDEX "chat_conversations_status_last_message_at_idx"
  ON "chat_conversations"("status", "last_message_at");
CREATE INDEX "chat_conversations_customer_user_id_last_message_at_idx"
  ON "chat_conversations"("customer_user_id", "last_message_at");
CREATE INDEX "chat_conversations_guest_session_id_last_message_at_idx"
  ON "chat_conversations"("guest_session_id", "last_message_at");
CREATE INDEX "chat_conversations_assigned_agent_id_status_last_message_at_idx"
  ON "chat_conversations"("assigned_agent_id", "status", "last_message_at");
CREATE INDEX "chat_messages_conversation_id_created_at_idx"
  ON "chat_messages"("conversation_id", "created_at");
CREATE INDEX "chat_messages_sender_agent_id_created_at_idx"
  ON "chat_messages"("sender_agent_id", "created_at");
CREATE INDEX "chat_events_conversation_id_created_at_idx"
  ON "chat_events"("conversation_id", "created_at");
CREATE INDEX "chat_events_actor_agent_id_created_at_idx"
  ON "chat_events"("actor_agent_id", "created_at");

ALTER TABLE "chat_conversations"
  ADD CONSTRAINT "chat_conversations_customer_user_id_fkey"
  FOREIGN KEY ("customer_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_conversations"
  ADD CONSTRAINT "chat_conversations_guest_session_id_fkey"
  FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_conversations"
  ADD CONSTRAINT "chat_conversations_assigned_agent_id_fkey"
  FOREIGN KEY ("assigned_agent_id") REFERENCES "staff_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sender_agent_id_fkey"
  FOREIGN KEY ("sender_agent_id") REFERENCES "staff_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_events"
  ADD CONSTRAINT "chat_events_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_events"
  ADD CONSTRAINT "chat_events_actor_agent_id_fkey"
  FOREIGN KEY ("actor_agent_id") REFERENCES "staff_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
