import { z } from "zod";

export const createWarrantyClaimSchema = z.object({
  orderItemId: z.uuid("Invalid order item ID"),
  quantity: z.number().int().positive().max(1000),
  issue: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).optional(),
});

export const warrantyClaimListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum([
    "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "RESOLVED", "CANCELLED",
  ]).optional(),
});

export const reviewWarrantyClaimSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED"]),
  resolutionNotes: z.string().trim().max(2000).optional(),
});

export const resolveWarrantyClaimSchema = z.object({
  resolution: z.enum(["REPAIR", "REPLACEMENT", "REFUND"]),
  resolutionNotes: z.string().trim().min(1).max(2000),
});

export type CreateWarrantyClaimInput = z.infer<typeof createWarrantyClaimSchema>;
export type WarrantyClaimListQuery = z.infer<typeof warrantyClaimListQuerySchema>;
export type ReviewWarrantyClaimInput = z.infer<typeof reviewWarrantyClaimSchema>;
export type ResolveWarrantyClaimInput = z.infer<typeof resolveWarrantyClaimSchema>;
