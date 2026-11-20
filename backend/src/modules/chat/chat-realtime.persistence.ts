import { Prisma } from "@prisma/client";
import type { ChatRealtimeEvent } from "@prisma/client";

export type PersistedChatRealtimeEvent = Pick<
  ChatRealtimeEvent,
  "id" | "conversationId" | "sequence" | "eventName" | "payload" | "createdAt"
>;

/**
 * Allocate a per-conversation sequence while holding the conversation row
 * lock, then persist the event in the same transaction as the chat mutation.
 * This makes the sequence reflect commit order for a single conversation.
 */
export async function persistChatRealtimeEvent(
  tx: Prisma.TransactionClient,
  input: {
    conversationId: string;
    eventName: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<PersistedChatRealtimeEvent> {
  const rows = await tx.$queryRaw<Array<{ realtimeSequence: number }>>`
    UPDATE "chat_conversations"
    SET "realtime_sequence" = "realtime_sequence" + 1
    WHERE "id" = ${input.conversationId}::uuid
    RETURNING "realtime_sequence" AS "realtimeSequence"
  `;

  const sequence = rows[0]?.realtimeSequence;
  if (sequence === undefined) {
    throw new Error("Unable to allocate chat realtime event sequence");
  }

  return tx.chatRealtimeEvent.create({
    data: {
      conversationId: input.conversationId,
      sequence,
      eventName: input.eventName,
      payload: input.payload,
    },
    select: {
      id: true,
      conversationId: true,
      sequence: true,
      eventName: true,
      payload: true,
      createdAt: true,
    },
  });
}
