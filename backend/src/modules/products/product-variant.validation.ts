import { z } from "zod";

export const createProductVariantSchema = z.object({
  productId: z.uuid("Invalid product ID"),

  sku: z
    .string()
    .trim()
    .min(1, "SKU is required"),

  name: z
    .string()
    .trim()
    .min(1, "Variant name is required"),

  price: z
    .string()
    .regex(
      /^\d+(\.\d{1,2})?$/,
      "Invalid price format",
    ),
});

export type CreateProductVariantInput = z.infer<
  typeof createProductVariantSchema
>;