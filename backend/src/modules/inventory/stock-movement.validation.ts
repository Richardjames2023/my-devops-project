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
    .optional(),

  reason: z
    .string()
    .trim()
    .optional(),

  notes: z
    .string()
    .trim()
    .optional(),
});

export type CreateStockMovementInput = z.infer<
  typeof createStockMovementSchema
>;