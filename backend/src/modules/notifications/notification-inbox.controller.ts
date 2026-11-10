import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notification-inbox.service";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const notificationParamsSchema = z.object({
  notificationId: z.uuid("Invalid notification ID"),
});

function identityFromRequest(req: AuthenticatedRequest) {
  if (!req.user) return null;
  return {
    recipientType: req.user.identityType,
    recipientId: req.user.id,
  } as const;
}

export async function getInbox(req: AuthenticatedRequest, res: Response): Promise<void> {
  const identity = identityFromRequest(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const result = paginationSchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const inbox = await listNotifications(identity, result.data);
  res.status(200).json({ message: "Notifications retrieved successfully", ...inbox });
}

export async function markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const identity = identityFromRequest(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const params = notificationParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(params.error).fieldErrors,
    });
    return;
  }

  const notification = await markNotificationRead(identity, params.data.notificationId);
  res.status(200).json({ message: "Notification marked as read", notification });
}

export async function markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const identity = identityFromRequest(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const result = await markAllNotificationsRead(identity);
  res.status(200).json({
    message: "Unread notifications marked as read",
    updatedCount: result.updatedCount,
  });
}
