import { z } from "zod";

export const analyticsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.preprocess(
    (value) => {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${value}T23:59:59.999Z`;
      }
      return value;
    },
    z.coerce.date(),
  ).optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: "The end date must be on or after the start date",
    });
  }
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
