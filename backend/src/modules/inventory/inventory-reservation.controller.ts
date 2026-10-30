import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { reservationIdSchema } from "./inventory-reservation.validation";
import { createInventoryReservationSchema } from "./inventory-reservation.validation";
import { createInventoryReservation,  confirmInventoryReservation, releaseInventoryReservation, } from "./inventory-reservation.service";

export async function create(
  req: Request,
  res: Response,
): Promise<void> {
  const result = createInventoryReservationSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const resultData = await createInventoryReservation(result.data);

  res.status(201).json({
    message: "Inventory reservation created successfully",
    ...resultData,
  });
}
export async function confirm(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = reservationIdSchema.safeParse(req.params);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const resultData = await confirmInventoryReservation(
    result.data.reservationId,
  );

  res.status(200).json({
    message: "Inventory reservation confirmed successfully",
    ...resultData,
  });
}
export async function release(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = reservationIdSchema.safeParse(req.params);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const resultData = await releaseInventoryReservation(
    result.data.reservationId,
  );

  res.status(200).json({
    message: "Inventory reservation released successfully",
    ...resultData,
  });
}