
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

export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
});

export type CreateOrderInput = z.infer<
  typeof createOrderSchema
>;
