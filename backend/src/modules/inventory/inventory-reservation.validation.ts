import { z } from "zod";

export const createInventoryReservationSchema = z.object({
  orderId: z.uuid("Invalid order ID"),


  inventoryId: z.uuid("Invalid inventory ID"),

  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),
});

export type CreateInventoryReservationInput = z.infer<
  typeof createInventoryReservationSchema >;

export const reservationIdSchema = z.object({
  reservationId: z.uuid("Invalid reservation ID"),
});

export type ReservationIdInput = z.infer<typeof reservationIdSchema>;