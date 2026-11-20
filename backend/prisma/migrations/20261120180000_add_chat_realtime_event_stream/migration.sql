ALTER TABLE "chat_conversations"
ADD COLUMN "realtime_sequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "chat_realtime_events" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_name" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_realtime_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_realtime_events_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "chat_realtime_events_conversation_id_sequence_key"
ON "chat_realtime_events"("conversation_id", "sequence");

CREATE INDEX "chat_realtime_events_conversation_id_sequence_idx"
ON "chat_realtime_events"("conversation_id", "sequence");
