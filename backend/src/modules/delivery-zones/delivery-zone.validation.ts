import { z } from "zod";
import { normalizeDeliveryCity, normalizeDeliveryState } from "./delivery-zone.normalization";

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const [coefficient, exponentPart] = value.toString().toLowerCase().split("e");
  const decimalPlaces = coefficient?.split(".")[1]?.length ?? 0;
  const exponent = exponentPart ? Number(exponentPart) : 0;

  return decimalPlaces - exponent <= 2;
}

const deliveryFeeSchema = z
  .number()
  .min(0)
  .max(9999999999.99)
  .refine(
    hasAtMostTwoDecimalPlaces,
    "Delivery fee must have no more than two decimal places",
  );

const locationSchema = z.object({
  state: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100).refine(
    (city) => city === "*" || !city.includes("*"),
    "City may only use * as the complete state-wide fallback value",
  ),
}).transform((location) => ({
  state: normalizeDeliveryState(location.state),
  city: location.city === "*" ? "*" : normalizeDeliveryCity(location.city),
}));

const locationsSchema = z.array(locationSchema).min(1).max(200)
  .refine(
    (locations) => new Set(locations.map(({ state, city }) => `${state}::${city}`)).size === locations.length,
    "A state and city combination may only appear once in a delivery zone",
  );

export const createDeliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(100),
  deliveryFee: deliveryFeeSchema,
  locations: locationsSchema,
});

export const updateDeliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  deliveryFee: deliveryFeeSchema.optional(),
  isActive: z.boolean().optional(),
  locations: locationsSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field must be supplied");

export const deliveryZoneQuoteQuerySchema = z.object({
  state: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
});

export type CreateDeliveryZoneInput = z.infer<typeof createDeliveryZoneSchema>;
export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;
