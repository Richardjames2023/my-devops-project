import { z } from "zod";

export const customerReturnHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum([
    "PENDING",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "RECEIVED",
    "INSPECTED",
    "COMPLETED",
    "CANCELLED",
  ]).optional(),
});
