import { z } from "zod";

const priceSchema = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Invalid price format");

export const createProductVariantSchema = z
  .object({
    productId: z.uuid("Invalid product ID"),
    sku: z.string().trim().min(1, "SKU is required"),
    name: z.string().trim().min(1, "Variant name is required"),
    price: priceSchema,
    hasWarranty: z.boolean().nullable().optional(),
    warrantyDuration: z.number().int().positive().optional(),
    warrantyTerms: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hasWarranty === true && data.warrantyDuration === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["warrantyDuration"],
        message: "Warranty duration is required for a variant warranty",
      });
    }

    if (
      data.hasWarranty !== true &&
      (data.warrantyDuration !== undefined || data.warrantyTerms !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hasWarranty"],
        message:
          "Variant warranty duration and terms are only allowed when its own warranty is enabled",
      });
    }
  });

export const updateProductVariantSchema = z
  .object({
    sku: z.string().trim().min(1, "SKU is required").optional(),
    name: z.string().trim().min(1, "Variant name is required").optional(),
    price: priceSchema.optional(),
    hasWarranty: z.boolean().nullable().optional(),
    warrantyDuration: z.number().int().positive().nullable().optional(),
    warrantyTerms: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one variant field must be provided",
  });

export const productVariantStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>;
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;
