import type { Response } from "express";
import { ChatConversationStatus } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  claimStaffChatConversation,
  getStaffChatConversation,
  listStaffChatConversations,
} from "./staff-chat.service";

const inboxQuerySchema = z.object({
  status: z.nativeEnum(ChatConversationStatus).default(
    ChatConversationStatus.WAITING_FOR_AGENT,
  ),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

const conversationIdSchema = z.object({ conversationId: z.uuid() });

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

  const result = await listStaffChatConversations(parsed.data);
  res.status(200).json({
    message: "Staff chat inbox retrieved",
    data: result,
  });
}

export async function getStaffChatConversationController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const conversation = await getStaffChatConversation(getConversationId(req));
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
