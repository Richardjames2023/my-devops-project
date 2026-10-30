import { z } from "zod";

const returnItemSchema = z.object({
  orderItemId: z.uuid("Invalid order item ID"),

  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),

  condition: z.enum([
    "UNOPENED",
    "USED",
    "DAMAGED",
    "DEFECTIVE",
    "WRONG_ITEM",
    "OTHER",
  ]),

  notes: z
    .string()
    .trim()
    .max(1000, "Notes cannot exceed 1000 characters")
    .optional(),
});

export const createReturnRequestSchema = z
  .object({
    orderId: z.uuid("Invalid order ID"),

    reason: z
      .string()
      .trim()
      .min(1, "Return reason is required")
      .max(500, "Return reason cannot exceed 500 characters"),

    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .optional(),

    items: z.array(returnItemSchema).min(1, "At least one item is required"),
  })
  .superRefine((data, ctx) => {
    const itemIds = data.items.map((item) => item.orderItemId);

    const uniqueItemIds = new Set(itemIds);

    if (uniqueItemIds.size !== itemIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each order item can only appear once in a return request",
      });
    }
  });

const receiveReturnItemSchema = z.object({
  returnItemId: z.uuid("Invalid return item ID"),
  receivedQuantity: z
    .number()
    .int("Received quantity must be a whole number")
    .positive("Received quantity must be greater than zero"),
});

export const receiveReturnRequestSchema = z
  .object({
    items: z
      .array(receiveReturnItemSchema)
      .min(1, "At least one returned item is required"),
  })
  .superRefine((data, ctx) => {
    const itemIds = data.items.map((item) => item.returnItemId);
    const uniqueItemIds = new Set(itemIds);

    if (uniqueItemIds.size !== itemIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each return item can only appear once",
      });
    }
  });

const inspectReturnItemSchema = z
  .object({
    returnItemId: z.uuid("Invalid return item ID"),
    inspectedQuantity: z
      .number()
      .int("Inspected quantity must be a whole number")
      .positive("Inspected quantity must be greater than zero"),
    acceptedQuantity: z
      .number()
      .int("Accepted quantity must be a whole number")
      .min(0, "Accepted quantity cannot be negative"),
    rejectedQuantity: z
      .number()
      .int("Rejected quantity must be a whole number")
      .min(0, "Rejected quantity cannot be negative"),
    condition: z.enum([
      "UNOPENED",
      "USED",
      "DAMAGED",
      "DEFECTIVE",
      "WRONG_ITEM",
      "OTHER",
    ]),
    notes: z
      .string()
      .trim()
      .max(1000, "Inspection notes cannot exceed 1000 characters")
      .optional(),
  })
  .superRefine((item, ctx) => {
    if (
      item.acceptedQuantity + item.rejectedQuantity !==
      item.inspectedQuantity
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["acceptedQuantity"],
        message:
          "Accepted quantity plus rejected quantity must equal inspected quantity",
      });
    }
  });

export const inspectReturnRequestSchema = z
  .object({
    items: z
      .array(inspectReturnItemSchema)
      .min(1, "At least one return item must be inspected"),
  })
  .superRefine((data, ctx) => {
    const itemIds = data.items.map((item) => item.returnItemId);

    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each return item can only appear once per inspection request",
      });
    }
  });

export type InspectReturnRequestInput = z.infer<
  typeof inspectReturnRequestSchema
>;

export type ReceiveReturnRequestInput = z.infer<
  typeof receiveReturnRequestSchema
>;

export type CreateReturnRequestInput = z.infer<
  typeof createReturnRequestSchema
>;

export const reviewReturnRequestSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED"]),
});

export type ReviewReturnRequestInput = z.infer<
  typeof reviewReturnRequestSchema
>;
