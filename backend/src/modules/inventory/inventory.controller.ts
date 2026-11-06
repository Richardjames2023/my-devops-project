import type { Request, Response } from "express";
import { z } from "zod";
import { createInventorySchema } from "./inventory.validation";
import {
  createInventory,
  expireStaleInventoryReservations,
} from "./inventory.service";

export async function create(
  req: Request,
  res: Response,
): Promise<void> {
  const result = createInventorySchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const inventory = await createInventory(result.data);

  res.status(201).json({
    message: "Inventory created successfully",
    inventory,
  });
}

export async function expireStaleReservations(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await expireStaleInventoryReservations();

  res.status(200).json({
    message: "Stale inventory reservations processed",
    ...result,
  });
}
