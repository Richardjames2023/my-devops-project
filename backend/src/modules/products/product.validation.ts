import { z } from "zod";

const productSlugSchema = z
  .string()
  .trim()
  .min(1, "Product slug is required")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain only lowercase letters, numbers, and hyphens",
  );

const priceSchema = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Invalid price format");

export const createProductSchema = z
  .object({
    categoryId: z.uuid("Invalid category ID"),
    name: z.string().trim().min(1, "Product name is required"),
    slug: productSlugSchema,
    description: z.string().trim().optional(),
    basePrice: priceSchema,
    hasWarranty: z.boolean().default(false),
    warrantyDuration: z.number().int().positive().optional(),
    warrantyTerms: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hasWarranty && data.warrantyDuration === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["warrantyDuration"],
        message: "Warranty duration is required when warranty is enabled",
      });
    }

    if (
      !data.hasWarranty &&
      (data.warrantyDuration !== undefined || data.warrantyTerms !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hasWarranty"],
        message:
          "Warranty duration and terms cannot be supplied when warranty is disabled",
      });
    }
  });

export const updateProductSchema = z
  .object({
    categoryId: z.uuid("Invalid category ID").optional(),
    name: z.string().trim().min(1, "Product name is required").optional(),
    slug: productSlugSchema.optional(),
    description: z.string().trim().nullable().optional(),
    basePrice: priceSchema.optional(),
    hasWarranty: z.boolean().optional(),
    warrantyDuration: z.number().int().positive().nullable().optional(),
    warrantyTerms: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one product field must be provided",
  });

export const productStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
