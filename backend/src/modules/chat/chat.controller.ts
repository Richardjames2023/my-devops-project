import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { logger } from "../../config/logger";
import type { ChatOwnerRequest } from "./chat.types";
import { generateChatAiReply } from "./ai/chat-ai.service";
import { listChatRealtimeEvents } from "./chat-realtime.service";
import {
  createConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  requestHumanHandoff,
  sendCustomerMessage,
} from "./chat.service";
import {
  chatConversationIdSchema,
  chatPaginationSchema,
  createChatMessageSchema,
} from "./chat.validation";

function getOwner(req: ChatOwnerRequest) {
  if (!req.chatOwner) {
    throw new AppError("Chat identity required", 401);
  }
  return req.chatOwner;
}

function getConversationId(value: unknown): string {
  const parsed = chatConversationIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("Invalid conversation ID", 400);
  }
  return parsed.data;
}

const realtimeSyncQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function parsePagination(query: unknown) {
  const parsed = chatPaginationSchema.safeParse(query);
  if (!parsed.success) {
    throw new AppError("Invalid pagination parameters", 400);
  }
  return parsed.data;
}

export async function createConversationController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const conversation = await createConversation(getOwner(req));
  res.status(201).json({
    message: "Chat conversation created",
    data: { conversation },
  });
}

export async function listConversationsController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const pagination = parsePagination(req.query);
  const result = await listConversations(
    getOwner(req),
    pagination.limit,
    pagination.cursor,
  );
  res.status(200).json({
    message: "Chat conversations retrieved",
    data: result,
  });
}

export async function getConversationController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const conversation = await getConversation(
    getOwner(req),
    getConversationId(req.params.conversationId),
  );
  res.status(200).json({
    message: "Chat conversation retrieved",
    data: { conversation },
  });
}

export async function listConversationMessagesController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const pagination = parsePagination(req.query);
  const result = await listConversationMessages(
    getOwner(req),
    getConversationId(req.params.conversationId),
    pagination.limit,
    pagination.cursor,
  );
  res.status(200).json({
    message: "Chat messages retrieved",
    data: result,
  });
}

export async function listConversationRealtimeEventsController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const parsed = realtimeSyncQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError("Invalid realtime synchronization parameters", 400);
  }

  const conversationId = getConversationId(req.params.conversationId);
  await getConversation(getOwner(req), conversationId);
  const result = await listChatRealtimeEvents(conversationId, parsed.data);

  res.status(200).json({
    message: "Chat realtime events retrieved",
    data: result,
  });
}

export async function sendCustomerMessageController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const parsed = createChatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const owner = getOwner(req);
  const conversationId = getConversationId(req.params.conversationId);

  const message = await sendCustomerMessage(
    owner,
    conversationId,
    parsed.data,
  );

  let automation: Awaited<ReturnType<typeof generateChatAiReply>>;

  try {
    automation = await generateChatAiReply({
      owner,
      conversationId,
      customerMessageId: message.id,
    });
  } catch (error) {
    logger.error(
      "Chat AI generation failed after customer message was accepted",
      undefined,
      {
        conversationId,
        customerMessageId: message.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );

    automation = { status: "UNAVAILABLE" };
  }

  res.status(201).json({
    message: "Chat message accepted",
    data: {
      message,
      automation,
    },
  });
}

export async function requestHumanHandoffController(
  req: ChatOwnerRequest,
  res: Response,
): Promise<void> {
  const conversation = await requestHumanHandoff(
    getOwner(req),
    getConversationId(req.params.conversationId),
  );
  res.status(200).json({
    message: "Human support requested",
    data: { conversation },
  });
}
