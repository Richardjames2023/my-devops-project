
import { z } from "zod";

export const addCartItemSchema = z.object({
  productVariantId: z.uuid("Invalid product variant ID"),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100"),
});

export const updateCartItemSchema = z.object({
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100"),
});

export type AddCartItemInput = z.infer<
  typeof addCartItemSchema
>;

export type UpdateCartItemInput = z.infer<
  typeof updateCartItemSchema
>;
