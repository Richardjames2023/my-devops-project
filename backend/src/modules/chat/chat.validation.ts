import { z } from "zod";

export const chatPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

export const createChatMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  clientMessageId: z.uuid(),
});

export const chatConversationIdSchema = z.uuid();
