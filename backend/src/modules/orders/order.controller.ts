import type { Response } from "express";
import { z } from "zod";
import {
  createOrderSchema,
  createGuestOrderSchema,
} from "./order.validation";
import {
  createOrder,
  createGuestOrder,
} from "./order.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import type { GuestSessionRequest } from "../guest-session/guest-session.middleware";
import { AppError } from "../../common/errors/AppError";

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = createOrderSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });
    return;
  }

  const order = await createOrder(req.user.id, result.data);

  res.status(201).json({
    message: "Order created successfully",
    order,
  });
}

export async function createGuest(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const result = createGuestOrderSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  if (!req.guestSessionId) {
    throw new AppError("Guest session required", 401);
  }

  const resultOrder = await createGuestOrder(
    req.guestSessionId,
    result.data,
  );

  res.status(201).json({
    message: "Guest order created successfully",
    order: resultOrder.order,
    guestAccessToken: resultOrder.guestAccessToken,
  });
}
