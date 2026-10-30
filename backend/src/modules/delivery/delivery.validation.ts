import { z } from "zod";

export const createDeliverySchema = z.object({
  packageId: z.uuid("Invalid package ID"),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.enum([
    "ASSIGNED",
    "PICKED_UP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "FAILED",
    "CANCELLED",
    "RETURNED",
  ]),
});

const deliveryLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const createDeliveryAttemptSchema = z.object({
  status: z.enum([
    "SUCCESSFUL",
    "CUSTOMER_UNAVAILABLE",
    "WRONG_ADDRESS",
    "REFUSED",
    "DAMAGED_PACKAGE",
    "OTHER",
  ]),
  notes: z.string().trim().optional(),
  location: deliveryLocationSchema.optional(),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryStatusInput = z.infer<
  typeof updateDeliveryStatusSchema
>;
export type CreateDeliveryAttemptInput = z.infer<
  typeof createDeliveryAttemptSchema
>;