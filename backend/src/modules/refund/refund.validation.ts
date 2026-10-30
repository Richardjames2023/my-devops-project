import { z } from "zod";

const refundItemSchema = z.object({
  returnItemId: z.uuid("Invalid return item ID"),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),
});

export const createRefundSchema = z
  .object({
    items: z
      .array(refundItemSchema)
      .min(1, "At least one return item is required"),

    reason: z
      .string()
      .trim()
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .superRefine((data, ctx) => {
    const itemIds = data.items.map((item) => item.returnItemId);

    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each return item can only appear once per refund request",
      });
    }
  });

export type CreateRefundInput = z.infer<typeof createRefundSchema>;

export const retryRefundSchema = z.object({
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, "Account number must contain exactly 10 digits"),

  bankId: z
    .string()
    .trim()
    .min(1, "Bank ID is required")
    .max(64, "Invalid bank ID"),
});

export type RetryRefundInput = z.infer<typeof retryRefundSchema>;
