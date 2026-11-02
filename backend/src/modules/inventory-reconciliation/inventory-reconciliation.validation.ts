
import { z } from "zod";

const reconciliationStatusSchema = z.enum([
  "PENDING",
  "UNDER_REVIEW",
  "REFUND_PENDING",
  "RESOLVED_FULFILLED",
  "RESOLVED_REFUNDED",
]);

export const listReconciliationsSchema = z.object({
  status: reconciliationStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reconciliationIdSchema = z.object({
  id: z.uuid("Invalid reconciliation ID"),
});

export const reviewReconciliationSchema = z.object({
  notes: z.string().trim().min(3).max(1000).optional(),
});

export const resolveReconciliationSchema = z.object({
  notes: z.string().trim().min(3).max(1000),
});

export const refundReconciliationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().min(3).max(1000).optional(),
});

export type ListReconciliationsInput = z.infer<
  typeof listReconciliationsSchema
>;

export type ReviewReconciliationInput = z.infer<
  typeof reviewReconciliationSchema
>;

export type ResolveReconciliationInput = z.infer<
  typeof resolveReconciliationSchema
>;

export type RefundReconciliationInput = z.infer<
  typeof refundReconciliationSchema
>;
