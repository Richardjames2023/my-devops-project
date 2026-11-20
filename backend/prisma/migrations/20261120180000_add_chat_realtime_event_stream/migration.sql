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

-- Keep the replay log in the same transaction as the source chat record.
-- The conversation row update serializes sequence allocation per conversation.
CREATE OR REPLACE FUNCTION "record_chat_message_realtime_event"()
RETURNS TRIGGER AS $$
DECLARE
  next_sequence INTEGER;
  sender_agent JSONB;
BEGIN
  UPDATE "chat_conversations"
  SET "realtime_sequence" = "realtime_sequence" + 1
  WHERE "id" = NEW."conversation_id"
  RETURNING "realtime_sequence" INTO next_sequence;

  IF NEW."sender_agent_id" IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', "id",
      'firstName', "firstName",
      'lastName', "lastName"
    ) INTO sender_agent
    FROM "staff_accounts"
    WHERE "id" = NEW."sender_agent_id";
  END IF;

  INSERT INTO "chat_realtime_events" (
    "id", "conversation_id", "sequence", "event_name", "payload", "created_at"
  ) VALUES (
    gen_random_uuid(),
    NEW."conversation_id",
    next_sequence,
    'chat:message:new',
    jsonb_strip_nulls(jsonb_build_object(
      'id', NEW."id",
      'conversationId', NEW."conversation_id",
      'senderType', NEW."sender_type",
      'senderAgentId', NEW."sender_agent_id",
      'senderAgent', sender_agent,
      'content', NEW."content",
      'createdAt', NEW."created_at"
    )),
    NEW."created_at"
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "chat_messages_realtime_event_insert"
AFTER INSERT ON "chat_messages"
FOR EACH ROW EXECUTE FUNCTION "record_chat_message_realtime_event"();

CREATE OR REPLACE FUNCTION "record_chat_lifecycle_realtime_event"()
RETURNS TRIGGER AS $$
DECLARE
  next_sequence INTEGER;
  conversation_row RECORD;
  assigned_agent JSONB;
  event_payload JSONB;
BEGIN
  UPDATE "chat_conversations"
  SET "realtime_sequence" = "realtime_sequence" + 1
  WHERE "id" = NEW."conversation_id"
  RETURNING
    "realtime_sequence", "status", "assigned_agent_id", "closed_at", "updated_at"
  INTO next_sequence, conversation_row;

  event_payload := jsonb_build_object(
    'conversationId', NEW."conversation_id",
    'status', NEW."new_status",
    'assignedAgentId', conversation_row.assigned_agent_id,
    'closedAt', conversation_row.closed_at,
    'updatedAt', conversation_row.updated_at
  );

  INSERT INTO "chat_realtime_events" (
    "id", "conversation_id", "sequence", "event_name", "payload", "created_at"
  ) VALUES (
    gen_random_uuid(),
    NEW."conversation_id",
    next_sequence,
    'chat:conversation:status',
    event_payload,
    NEW."created_at"
  );

  IF NEW."event_type" = 'AGENT_ASSIGNED' AND conversation_row.assigned_agent_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', "id",
      'firstName', "firstName",
      'lastName', "lastName"
    ) INTO assigned_agent
    FROM "staff_accounts"
    WHERE "id" = conversation_row.assigned_agent_id;

    UPDATE "chat_conversations"
    SET "realtime_sequence" = "realtime_sequence" + 1
    WHERE "id" = NEW."conversation_id"
    RETURNING "realtime_sequence" INTO next_sequence;

    INSERT INTO "chat_realtime_events" (
      "id", "conversation_id", "sequence", "event_name", "payload", "created_at"
    ) VALUES (
      gen_random_uuid(),
      NEW."conversation_id",
      next_sequence,
      'chat:conversation:assigned',
      jsonb_build_object(
        'conversationId', NEW."conversation_id",
        'assignedAgent', assigned_agent
      ),
      NEW."created_at"
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "chat_events_realtime_event_insert"
AFTER INSERT ON "chat_events"
FOR EACH ROW EXECUTE FUNCTION "record_chat_lifecycle_realtime_event"();
