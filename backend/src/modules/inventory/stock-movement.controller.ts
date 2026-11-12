import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import {
  adjustStockSchema,
  createStockMovementSchema,
} from "./stock-movement.validation";
import {
  adjustStock,
  createStockMovement,
} from "./stock-movement.service";

export async function create(
  req: AuthenticatedRequest,
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

export async function adjust(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user || req.user.identityType !== "STAFF") {
    throw new AppError("A staff account is required", 403);
  }

  const result = adjustStockSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const resultData = await adjustStock(result.data, req.user.id, {
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(req.get("user-agent")
      ? { userAgent: req.get("user-agent")! }
      : {}),
  });

  res.status(200).json({
    message: "Inventory stock adjusted successfully",
    ...resultData,
  });
}
