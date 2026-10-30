import type { Response } from "express";
import { z } from "zod";
import { createOrderSchema } from "./order.validation";
import { createOrder } from "./order.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = createOrderSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });
    return;
  }

  const order = await createOrder(
    req.user.id,
    result.data,
  );

  res.status(201).json({
    message: "Order created successfully",
    order,
  });
}