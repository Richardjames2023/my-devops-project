import { z } from "zod";

export const positionSchema = z.enum(["HERO", "TOP", "BOTTOM"]);

export const targetUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .optional()
  .refine(
    (value) =>
      value == null ||
      (
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\")
      ) ||
      /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(value),
    "Target URL must be a root-relative path or valid HTTPS URL",
  );

const optionalText = (max: number) =>
  z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(max).nullable().optional(),
  );

const optionalUrl = z.preprocess(
  (value) => value === "" ? null : value,
  targetUrlSchema,
);

const ctaFields = {
  primaryCtaLabel: optionalText(60),
  primaryCtaUrl: optionalUrl,
  secondaryCtaLabel: optionalText(60),
  secondaryCtaUrl: optionalUrl,
};

function hasPairedCta(
  value: {
    primaryCtaLabel?: string | null;
    primaryCtaUrl?: string | null;
    secondaryCtaLabel?: string | null;
    secondaryCtaUrl?: string | null;
  },
  partial: boolean,
) {
  const primaryTouched =
    value.primaryCtaLabel !== undefined || value.primaryCtaUrl !== undefined;
  const secondaryTouched =
    value.secondaryCtaLabel !== undefined || value.secondaryCtaUrl !== undefined;

  if (partial && primaryTouched &&
      (value.primaryCtaLabel === undefined || value.primaryCtaUrl === undefined)) return false;
  if (partial && secondaryTouched &&
      (value.secondaryCtaLabel === undefined || value.secondaryCtaUrl === undefined)) return false;

  return (
    (value.primaryCtaLabel == null) === (value.primaryCtaUrl == null) &&
    (value.secondaryCtaLabel == null) === (value.secondaryCtaUrl == null)
  );
}

export const bannerContentFieldsSchema = z.object({
  eyebrow: optionalText(80),
  headline: optionalText(160),
  description: optionalText(500),
  badgeText: optionalText(40),
  ...ctaFields,
}).refine((value) => hasPairedCta(value, false), {
  path: ["primaryCtaLabel"],
  message: "Each CTA label and URL must be provided together, or both omitted",
});

const bannerFieldsSchema = z.object({
  title: z.string().trim().min(2).max(120),
  position: positionSchema,
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  targetUrl: targetUrlSchema,
  altText: optionalText(255),
  ...bannerContentFieldsSchema.shape,
  priority: z.coerce.number().int().min(-1000).max(1000).default(0),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).default("DRAFT"),
});

export const createBannerSchema = bannerFieldsSchema
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    path: ["endAt"],
    message: "End date must be later than start date",
  })
  .refine((value) => hasPairedCta(value, false), {
    path: ["primaryCtaLabel"],
    message: "Each CTA label and URL must be provided together, or both omitted",
  });

export const updateBannerSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  position: positionSchema.optional(),
  startAt: z.iso.datetime({ offset: true }).optional(),
  endAt: z.iso.datetime({ offset: true }).optional(),
  targetUrl: targetUrlSchema,
  altText: optionalText(255),
  eyebrow: optionalText(80),
  headline: optionalText(160),
  description: optionalText(500),
  badgeText: optionalText(40),
  ...ctaFields,
  priority: z.coerce.number().int().min(-1000).max(1000).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
})
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided")
  .refine(
    (value) =>
      value.startAt === undefined ||
      value.endAt === undefined ||
      new Date(value.endAt) > new Date(value.startAt),
    { path: ["endAt"], message: "End date must be later than start date" },
  )
  .refine((value) => hasPairedCta(value, true), {
    path: ["primaryCtaLabel"],
    message: "Update each CTA label and URL together",
  });

export const listBannersQuerySchema = z.object({
  position: positionSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
export type BannerContentInput = z.infer<typeof bannerContentFieldsSchema>;
