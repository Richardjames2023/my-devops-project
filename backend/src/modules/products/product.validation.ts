import { z } from "zod";

export const createProductSchema = z.object({
  categoryId: z.uuid("Invalid category ID"),

  name: z
    .string()
    .trim()
    .min(1, "Product name is required"),

  slug: z
    .string()
    .trim()
    .min(1, "Product slug is required")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain only lowercase letters, numbers, and hyphens",
    ),

  description: z
    .string()
    .trim()
    .optional(),

  basePrice: z
    .string()
    .regex(
      /^\d+(?:\.\d{1,2})?$/,
      "Invalid price format",
    ),
});

export type CreateProductInput = z.infer<
  typeof createProductSchema
>;