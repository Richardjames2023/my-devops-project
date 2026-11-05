import { z } from "zod";

export const createProductVariantSchema = z
  .object({
    productId: z.uuid("Invalid product ID"),

    sku: z.string().trim().min(1, "SKU is required"),

    name: z.string().trim().min(1, "Variant name is required"),

    price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price format"),

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

export type CreateProductVariantInput = z.infer<
  typeof createProductVariantSchema
>;
