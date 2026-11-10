import { z } from "zod";

const categorySlugSchema = z
  .string()
  .trim()
  .min(1, "Category slug is required")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain only lowercase letters, numbers, and hyphens",
  );

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  slug: categorySlugSchema,
  description: z.string().trim().nullable().optional(),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one category field must be provided",
  });

export const categoryStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
