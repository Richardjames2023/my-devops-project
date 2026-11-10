import { z } from "zod";

export const updateDeliveryTrackingSchema = z.object({
  trackingNumber: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100).optional(),
  externalReference: z.string().trim().min(1).max(200).optional(),
});

export type UpdateDeliveryTrackingInput = z.infer<
  typeof updateDeliveryTrackingSchema
>;
