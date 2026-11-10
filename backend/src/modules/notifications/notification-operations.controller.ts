import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  listDeadEmailDeliveries,
  listDeadNotificationOutbox,
  retryDeadEmailDelivery,
  retryDeadNotificationOutbox,
} from "./notification-operations.service";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idSchema = z.string().uuid();

function parsePagination(req: AuthenticatedRequest) {
  return paginationSchema.safeParse(req.query);
}

export async function getDeadOutbox(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = parsePagination(req);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid pagination parameters" });
    return;
  }
  const result = await listDeadNotificationOutbox(parsed.data.page, parsed.data.pageSize);
  res.status(200).json({ message: "Dead notification events retrieved", ...result });
}

export async function getDeadEmailDeliveries(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = parsePagination(req);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid pagination parameters" });
    return;
  }
  const result = await listDeadEmailDeliveries(parsed.data.page, parsed.data.pageSize);
  res.status(200).json({ message: "Dead email deliveries retrieved", ...result });
}

export async function retryOutboxEvent(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid notification event ID" });
    return;
  }
  const result = await retryDeadNotificationOutbox(parsed.data);
  res.status(200).json({ message: "Notification event queued for retry", event: result });
}

export async function retryEmailDelivery(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email delivery ID" });
    return;
  }
  const result = await retryDeadEmailDelivery(parsed.data);
  res.status(200).json({ message: "Email delivery queued for retry", delivery: result });
}
