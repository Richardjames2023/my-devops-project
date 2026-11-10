import { z } from "zod";

const moneySchema = z
  .string()
  .trim()
  .regex(/^\\d+(?:\\.\\d{1,2})?$/, "Enter a valid amount with up to two decimal places");

const couponFields = {
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Coupon code may contain letters, numbers, underscores, and hyphens")
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().max(500).nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: moneySchema,
  maxDiscountAmount: moneySchema.nullable().optional(),
  minimumSubtotal: moneySchema.optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  isActive: z.boolean().optional(),
};

export const createCouponSchema = z.object(couponFields).superRefine((data, ctx) => {
  const value = Number(data.discountValue);
  if (data.discountType === "PERCENTAGE" && (value <= 0 || value > 100)) {
    ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount must be greater than 0 and at most 100" });
  }
  if (data.discountType === "FIXED_AMOUNT" && value <= 0) {
    ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Fixed discount must be greater than zero" });
  }
  if (data.startsAt && data.expiresAt && new Date(data.expiresAt) <= new Date(data.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry must be later than the start date" });
  }
  if (data.maxDiscountAmount && Number(data.maxDiscountAmount) <= 0) {
    ctx.addIssue({ code: "custom", path: ["maxDiscountAmount"], message: "Maximum discount must be greater than zero" });
  }
});

export const updateCouponSchema = createCouponSchema.partial().omit({ code: true }).extend({
  code: couponFields.code.optional(),
}).superRefine((data, ctx) => {
  if (data.discountType === "PERCENTAGE" && data.discountValue !== undefined) {
    const value = Number(data.discountValue);
    if (value <= 0 || value > 100) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount must be greater than 0 and at most 100" });
  }
  if (data.startsAt && data.expiresAt && new Date(data.expiresAt) <= new Date(data.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry must be later than the start date" });
  }
});

export const couponListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z.enum(["true", "false"]).optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
