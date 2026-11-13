import type { Request, Response } from "express";
import { z } from "zod";
import {
  createOrderSchema,
  createGuestOrderSchema,
} from "./order.validation";
import {
  createOrder,
  createGuestOrder,
  getGuestOrder,
  revokeGuestOrderAccess,
  cancelOrder,
  adminCancelOrder,
} from "./order.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import type { GuestSessionRequest } from "../guest-session/guest-session.middleware";
import { AppError } from "../../common/errors/AppError";
import { isValidGuestOrderAccessToken } from "./guest-order-access";
import { customerOrderHistoryQuerySchema } from "./order-history.validation";
import { listCustomerOrders } from "./order.service";

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

export async function getGuest(
  req: Request<{ orderId: string }, unknown, unknown, unknown, {}>
  & { headers: { "x-guest-order-token"?: string } },
  res: Response,
): Promise<void> {
  const orderIdSchema = z.uuid();
  const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

  const orderIdResult = orderIdSchema.safeParse(req.params.orderId);
  const tokenResult = tokenSchema.safeParse(
    req.headers["x-guest-order-token"],
  );

  if (!orderIdResult.success || !tokenResult.success) {
    throw new AppError("Order not found", 404);
  }

  const order = await getGuestOrder(
    orderIdResult.data,
    tokenResult.data,
  );

  res.status(200).json({
    message: "Order retrieved successfully",
    order,
  });
}


export async function cancel(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  const orderIdResult = z.uuid().safeParse(req.params.orderId);

  if (!orderIdResult.success) {
    throw new AppError("Invalid order ID", 400);
  }

  const order = await cancelOrder(
    orderIdResult.data,
    req.user.id,
    {
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(req.get("user-agent")
        ? { userAgent: req.get("user-agent")! }
        : {}),
    },
  );

  res.status(200).json({
    message: order.alreadyCancelled
      ? "Order has already been cancelled"
      : "Order cancelled successfully",
    order,
  });
}

export async function adminCancel(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  const orderIdResult = z.uuid().safeParse(req.params.orderId);

  if (!orderIdResult.success) {
    throw new AppError("Invalid order ID", 400);
  }

  const order = await adminCancelOrder(
    orderIdResult.data,
    req.user.id,
    {
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(req.get("user-agent")
        ? { userAgent: req.get("user-agent")! }
        : {}),
    },
  );

  res.status(200).json({
    message: order.alreadyCancelled
      ? "Order has already been cancelled"
      : "Order cancelled successfully by admin",
    order,
  });
}


export async function listMine(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  const queryResult = customerOrderHistoryQuerySchema.safeParse(req.query);

  if (!queryResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(queryResult.error).fieldErrors,
    });
    return;
  }

  const result = await listCustomerOrders(req.user.id, queryResult.data);

  res.status(200).json({
    message: "Orders retrieved successfully",
    ...result,
  });
}


export async function revokeGuest(
  req: Request,
  res: Response,
): Promise<void> {
  const orderId = z.uuid().safeParse(req.params.orderId);
  const token = req.get("x-guest-order-token");
  if (!orderId.success || !isValidGuestOrderAccessToken(token)) {
    throw new AppError("Order not found", 404);
  }
  const result = await revokeGuestOrderAccess(orderId.data, token);
  res.status(200).json({
    message: "Guest order access revoked successfully",
    ...result,
  });
}
