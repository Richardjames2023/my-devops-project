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