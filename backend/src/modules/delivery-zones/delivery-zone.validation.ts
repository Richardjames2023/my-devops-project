import { z } from "zod";

const locationSchema = z.object({
  state: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
}).transform((location) => ({
  state: location.state.toUpperCase(),
  city: location.city.toUpperCase(),
}));

const locationsSchema = z.array(locationSchema).min(1).max(200)
  .refine(
    (locations) => new Set(locations.map(({ state, city }) => `${state}::${city}`)).size === locations.length,
    "A state and city combination may only appear once in a delivery zone",
  );

export const createDeliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(100),
  deliveryFee: z.number().min(0).max(9999999999.99),
  locations: locationsSchema,
});

export const updateDeliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  deliveryFee: z.number().min(0).max(9999999999.99).optional(),
  isActive: z.boolean().optional(),
  locations: locationsSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field must be supplied");

export const deliveryZoneQuoteQuerySchema = z.object({
  state: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
});

export type CreateDeliveryZoneInput = z.infer<typeof createDeliveryZoneSchema>;
export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;
