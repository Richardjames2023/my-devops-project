import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  claimStaffChatConversation,
  closeStaffChatConversation,
  getStaffChatConversation,
  listStaffChatConversations,
  sendStaffChatMessage,
} from "./staff-chat.service";

const inboxQuerySchema = z.object({
  status: z.enum(["WAITING_FOR_AGENT", "HUMAN_ACTIVE", "CLOSED"]).default(
    "WAITING_FOR_AGENT",
  ),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

const conversationIdSchema = z.object({ conversationId: z.uuid() });
const transcriptQuerySchema = z.object({
  messageLimit: z.coerce.number().int().min(1).max(100).default(50),
  messageCursor: z.uuid().optional(),
});
const staffMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  clientMessageId: z.uuid(),
});

function getStaffActor(req: AuthenticatedRequest): string {
  if (!req.user || req.user.identityType !== "STAFF") {
    throw new AppError("Staff authentication required", 401);
  }
  return req.user.id;
}

function getConversationId(req: AuthenticatedRequest): string {
  const parsed = conversationIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new AppError("Invalid conversation ID", 400);
  }
  return parsed.data.conversationId;
}

export async function listStaffChatConversationsController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = inboxQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const result = await listStaffChatConversations({
    status: parsed.data.status,
    limit: parsed.data.limit,
    ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
  });
  res.status(200).json({
    message: "Staff chat inbox retrieved",
    data: result,
  });
}

export async function getStaffChatConversationController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = transcriptQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const conversation = await getStaffChatConversation(getConversationId(req), {
    limit: parsed.data.messageLimit,
    ...(parsed.data.messageCursor
      ? { cursor: parsed.data.messageCursor }
      : {}),
  });
  res.status(200).json({
    message: "Staff chat conversation retrieved",
    data: { conversation },
  });
}

export async function claimStaffChatConversationController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const conversation = await claimStaffChatConversation(
    getConversationId(req),
    getStaffActor(req),
  );
  res.status(200).json({
    message: "Chat conversation claimed",
    data: { conversation },
  });
}

export async function sendStaffChatMessageController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = staffMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const message = await sendStaffChatMessage(
    getConversationId(req),
    getStaffActor(req),
    parsed.data,
  );
  res.status(201).json({
    message: "Staff chat reply accepted",
    data: { message },
  });
}

export async function closeStaffChatConversationController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const conversation = await closeStaffChatConversation(
    getConversationId(req),
    getStaffActor(req),
  );
  res.status(200).json({
    message: "Chat conversation closed",
    data: { conversation },
  });
}
