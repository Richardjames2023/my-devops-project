import { z } from "zod";

export const staffOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "PROCESSING",
    "PARTIALLY_FULFILLED",
    "FULFILLED",
    "CANCELLED",
    "COMPLETED",
  ]).optional(),
  paymentStatus: z.enum([
    "PENDING",
    "INITIALIZATION_UNKNOWN",
    "PROCESSING",
    "SUCCESS",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
  ]).optional(),
  from: z.coerce.date().optional(),
  to: z.preprocess(
    (value) => {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${value}T23:59:59.999Z`;
      }
      return value;
    },
    z.coerce.date(),
  ).optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: "The end date must be on or after the start date",
    });
  }
});

export type StaffOrderListQuery = z.infer<typeof staffOrderListQuerySchema>;
