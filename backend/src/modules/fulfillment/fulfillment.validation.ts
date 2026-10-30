import { z } from "zod";

export const createFulfillmentSchema = z.object({
  orderId: z.uuid("Invalid order ID"),
});

export type CreateFulfillmentInput = z.infer<
  typeof createFulfillmentSchema
>;

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