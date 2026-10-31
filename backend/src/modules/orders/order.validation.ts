
import { z } from "zod";

const shippingAddressSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required"),

  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required"),

  address: z
    .string()
    .trim()
    .min(1, "Address is required"),

  city: z
    .string()
    .trim()
    .min(1, "City is required"),

  state: z
    .string()
    .trim()
    .min(1, "State is required"),

  postalCode: z
    .string()
    .trim()
    .min(1, "Postal code is required"),

  nearestLandmark: z
    .string()
    .trim()
    .optional(),
});

// Existing authenticated checkout validation
export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
});

// Guest checkout requires a valid customer email
export const createGuestOrderSchema = createOrderSchema.extend({
  customerEmail: z
    .string()
    .trim()
    .email("A valid email address is required"),
});

export type CreateOrderInput = z.infer<
  typeof createOrderSchema
>;

export type CreateGuestOrderInput = z.infer<
  typeof createGuestOrderSchema
>;
