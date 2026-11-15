import { z } from "zod";

export const positionSchema = z.enum(["HERO", "TOP", "BOTTOM"]);

const targetUrlSchema = z.string().trim().max(2048).nullable().optional().refine(
  (value) => value == null || value.startsWith("/") || /^https:\/\//i.test(value),
  "Target URL must be a relative path or HTTPS URL",
);

export const createBannerSchema = z.object({
  title: z.string().trim().min(2).max(120),
  position: positionSchema,
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  targetUrl: targetUrlSchema,
  altText: z.string().trim().max(255).nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).default("DRAFT"),
}).refine((value) => new Date(value.endAt) > new Date(value.startAt), {
  path: ["endAt"], message: "End date must be later than start date",
});

export const updateBannerSchema = createBannerSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided",
);

export const listBannersQuerySchema = z.object({
  position: positionSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
