import { z } from "zod";

const priceSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Price must be a valid non-negative amount")
  .transform((value) => value);

export const productCatalogQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    minPrice: priceSchema.optional(),
    maxPrice: priceSchema.optional(),
    sort: z
      .enum(["newest", "price_asc", "price_desc", "name_asc"])
      .default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(12),
  })
  .superRefine((query, ctx) => {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      Number(query.minPrice) > Number(query.maxPrice)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "maxPrice must be greater than or equal to minPrice",
      });
    }
  });

export type ProductCatalogQuery = z.infer<typeof productCatalogQuerySchema>;
