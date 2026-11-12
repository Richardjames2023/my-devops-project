import { z } from "zod";

export const addWishlistItemSchema = z.object({
  productId: z.uuid(),
});
