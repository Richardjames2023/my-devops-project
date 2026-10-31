import { z } from "zod";

export const createPaymentSchema = z.object({
  orderId: z.uuid("Invalid order ID"),

  provider: z.enum([
    "PAYSTACK",
    "FLUTTERWAVE",
    "STRIPE",
    "BANK_TRANSFER",
    "CASH",
  ]),
});

export type CreatePaymentInput = z.infer<
  typeof createPaymentSchema
>;

export const createGuestPaymentSchema = createPaymentSchema.extend({
  guestAccessToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "Invalid guest order access token"),
});

export type CreateGuestPaymentInput = z.infer<
  typeof createGuestPaymentSchema
>;