import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";

export async function listChatRealtimeEvents(
  conversationId: string,
  input: { after: number; limit: number },
) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, realtimeSequence: true },
  });
  if (!conversation) throw new AppError("Conversation not found", 404);

  if (input.after > conversation.realtimeSequence) {
    throw new AppError("Invalid realtime event cursor", 400);
  }

  const rows = await prisma.chatRealtimeEvent.findMany({
    where: {
      conversationId,
      sequence: { gt: input.after, lte: conversation.realtimeSequence },
    },
    orderBy: { sequence: "asc" },
    take: input.limit + 1,
    select: {
      id: true,
      sequence: true,
      eventName: true,
      payload: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items[items.length - 1];

  return {
    items: items.map((event) => ({
      eventId: event.id,
      sequence: event.sequence,
      event: event.eventName,
      payload: event.payload,
      createdAt: event.createdAt,
    })),
    nextCursor: hasMore ? last?.sequence ?? input.after : null,
    lastSequence: last?.sequence ?? input.after,
    currentSequence: conversation.realtimeSequence,
    hasMore,
  };
}
