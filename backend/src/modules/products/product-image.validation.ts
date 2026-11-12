import { z } from "zod";

export const updateProductImageSchema = z
  .object({
    altText: z
      .string()
      .trim()
      .max(255, "Image alt text cannot exceed 255 characters")
      .nullable()
      .optional(),
    sortOrder: z
      .number()
      .int("Sort order must be a whole number")
      .min(0, "Sort order cannot be negative")
      .max(10_000, "Sort order is too large")
      .optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one image field must be provided",
  });

export type UpdateProductImageInput = z.infer<
  typeof updateProductImageSchema
>;
