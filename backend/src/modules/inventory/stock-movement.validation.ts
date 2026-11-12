import { z } from "zod";

export const createStockMovementSchema = z.object({
  inventoryId: z.uuid("Invalid inventory ID"),

  type: z.enum([
    "RECEIVED",
    "SOLD",
    "RETURNED",
    "DAMAGED",
    "LOST",
    "ADJUSTMENT",
  ]),

  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),

  reference: z
    .string()
    .trim()
    .max(120, "Reference must be 120 characters or fewer")
    .optional(),

  reason: z
    .string()
    .trim()
    .max(500, "Reason must be 500 characters or fewer")
    .optional(),

  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer")
    .optional(),
});

export const adjustStockSchema = z.object({
  inventoryId: z.uuid("Invalid inventory ID"),
  direction: z.enum(["INCREASE", "DECREASE"]),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero")
    .max(1_000_000, "Quantity exceeds the allowed adjustment limit"),
  reason: z
    .string()
    .trim()
    .min(3, "A reason of at least 3 characters is required")
    .max(500, "Reason must be 500 characters or fewer"),
  reference: z
    .string()
    .trim()
    .max(120, "Reference must be 120 characters or fewer")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer")
    .optional(),
});

export type CreateStockMovementInput = z.infer<
  typeof createStockMovementSchema
>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
