import { z } from "zod";

export const createInventorySchema = z.object({
  productVariantId: z.uuid("Invalid product variant ID"),

  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(0, "Quantity cannot be negative"),
});

export type CreateInventoryInput = z.infer<
  typeof createInventorySchema
>;