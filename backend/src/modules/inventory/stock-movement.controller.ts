import type { Request, Response } from "express";
import { z } from "zod";
import { createStockMovementSchema } from "./stock-movement.validation";
import { createStockMovement } from "./stock-movement.service";

export async function create(
  req: Request,
  res: Response,
): Promise<void> {
  const result = createStockMovementSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const resultData = await createStockMovement(result.data);

  res.status(201).json({
    message: "Stock movement created successfully",
    ...resultData,
  });
}