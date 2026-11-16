import { z } from "zod";

export const addWishlistItemSchema = z.object({
  productId: z.uuid(),
});


export const moveWishlistItemToCartSchema = z.object({
  productVariantId: z.uuid("Invalid product variant ID"),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100"),
});
