import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { ChatOwnerRequest } from "./chat.types";
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

  const message = await sendCustomerMessage(
    getOwner(req),
    getConversationId(req.params.conversationId),
    parsed.data,
  );
  res.status(201).json({
    message: "Chat message accepted",
    data: {
      message,
      automation: { status: "NOT_CONFIGURED" },
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
