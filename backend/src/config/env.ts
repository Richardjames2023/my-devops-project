import "dotenv/config";
import { z } from "zod";
import { isSecureProductionEmailUrl } from "./url-validation";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(5000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),

  PAYSTACK_SECRET_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1, "PAYSTACK_SECRET_KEY cannot be empty").optional(),
  ),

  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  COOKIE_SAME_SITE: z
    .enum(["lax", "strict", "none"])
    .default("lax"),

  EMAIL_DELIVERY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RESEND_WEBHOOK_SECRET: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  RESEND_API_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  EMAIL_FROM: z.preprocess((value) => value === "" ? undefined : value, z.string().min(3).refine((value) => {
    const normalized = value.trim();
    const match = normalized.match(/<([^<>]+)>$/);
    const address = match?.[1] ?? normalized;
    return z.string().email().safeParse(address.trim()).success;
  }).optional()),
  APP_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.EMAIL_DELIVERY_ENABLED) {
    context.addIssue({
      code: "custom",
      path: ["EMAIL_DELIVERY_ENABLED"],
      message: "EMAIL_DELIVERY_ENABLED must be true in production because customer email verification is required",
    });
  }

  if (value.NODE_ENV === "production" && !value.PAYSTACK_SECRET_KEY) {
    context.addIssue({
      code: "custom",
      path: ["PAYSTACK_SECRET_KEY"],
      message: "PAYSTACK_SECRET_KEY is required in production",
    });
  }

  if (value.EMAIL_DELIVERY_ENABLED && !value.RESEND_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required when email delivery is enabled",
    });
  }
  if (value.EMAIL_DELIVERY_ENABLED && !value.RESEND_WEBHOOK_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_WEBHOOK_SECRET"],
      message: "RESEND_WEBHOOK_SECRET is required when email delivery is enabled",
    });
  }
  if (value.EMAIL_DELIVERY_ENABLED && !value.APP_BASE_URL) {
    context.addIssue({
      code: "custom",
      path: ["APP_BASE_URL"],
      message: "APP_BASE_URL is required when email delivery is enabled",
    });
  }
  if (value.EMAIL_DELIVERY_ENABLED && !value.EMAIL_FROM) {
    context.addIssue({
      code: "custom",
      path: ["EMAIL_FROM"],
      message: "EMAIL_FROM is required when email delivery is enabled",
    });
  }
  if (
    value.EMAIL_DELIVERY_ENABLED &&
    value.APP_BASE_URL &&
    !isSecureProductionEmailUrl(value.NODE_ENV, value.EMAIL_DELIVERY_ENABLED, value.APP_BASE_URL)
  ) {
    context.addIssue({
      code: "custom",
      path: ["APP_BASE_URL"],
      message: "APP_BASE_URL must use HTTPS when email delivery is enabled in production",
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(parsedEnv.error));
  process.exit(1);
}

export const env = parsedEnv.data;
