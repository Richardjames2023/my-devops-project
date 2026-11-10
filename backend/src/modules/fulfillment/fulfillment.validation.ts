import { z } from "zod";

export const createFulfillmentSchema = z.object({
  orderId: z.uuid("Invalid order ID"),
});

export type CreateFulfillmentInput = z.infer<
  typeof createFulfillmentSchema
>;

export const allocatePackageSchema = z.object({
  items: z.array(
    z.object({
      orderItemId: z.uuid("Invalid order item ID"),
      quantity: z.number().int().positive(),
    }),
  ).min(1, "A package must contain at least one order item"),
  weight: z.number().positive().optional(),
  dimensions: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  const ids = value.items.map((item) => item.orderItemId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: "custom",
      path: ["items"],
      message: "An order item can only appear once in a package",
    });
  }
});

export type AllocatePackageInput = z.infer<typeof allocatePackageSchema>;

export const updatePackageStatusSchema = z.object({
  status: z.enum([
    "PACKING",
    "PACKED",
    "HANDED_TO_COURIER",
    "IN_TRANSIT",
    "DELIVERED",
    "LOST",
    "DAMAGED",
    "RETURNED",
  ]),
});

export type UpdatePackageStatusInput = z.infer<
  typeof updatePackageStatusSchema
>;