import { z } from "zod";

export const positionSchema = z.enum(["HERO", "TOP", "BOTTOM"]);

const targetUrlSchema = z.string().trim().max(2048).nullable().optional().refine(
  (value) => value == null || value.startsWith("/") || /^https:\/\//i.test(value),
  "Target URL must be a relative path or HTTPS URL",
);

const bannerFieldsSchema = z.object({
  title: z.string().trim().min(2).max(120),
  position: positionSchema,
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  targetUrl: targetUrlSchema,
  altText: z.string().trim().max(255).nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).default("DRAFT"),
});

export const createBannerSchema = bannerFieldsSchema.refine(
  (value) => new Date(value.endAt) > new Date(value.startAt),
  {
    path: ["endAt"],
    message: "End date must be later than start date",
  },
);

export const updateBannerSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  position: positionSchema.optional(),
  startAt: z.iso.datetime({ offset: true }).optional(),
  endAt: z.iso.datetime({ offset: true }).optional(),
  targetUrl: targetUrlSchema,
  altText: z.string().trim().max(255).nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided",
).refine(
  (value) =>
    value.startAt === undefined ||
    value.endAt === undefined ||
    new Date(value.endAt) > new Date(value.startAt),
  {
    path: ["endAt"],
    message: "End date must be later than start date",
  },
);

export const listBannersQuerySchema = z.object({
  position: positionSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
