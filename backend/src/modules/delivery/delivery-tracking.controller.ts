import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { updateDeliveryTrackingSchema } from "./delivery-tracking.validation";
import {
  getCustomerOrderDeliveryTracking,
  getGuestOrderDeliveryTracking,
  updateDeliveryTracking,
} from "./delivery-tracking.service";

const orderIdSchema = z.uuid("Invalid order ID");
const deliveryIdSchema = z.uuid("Invalid delivery ID");
const guestTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export async function updateTracking(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const deliveryId = deliveryIdSchema.safeParse(req.params.deliveryId);
  const body = updateDeliveryTrackingSchema.safeParse(req.body);

  if (!deliveryId.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!deliveryId.success
          ? { deliveryId: ["Invalid delivery ID"] }
          : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  if (!req.user) throw new AppError("Authentication required", 401);

  const result = await updateDeliveryTracking(deliveryId.data, body.data);
  res.status(200).json({
    message: "Delivery tracking details updated successfully",
    ...result,
  });
}

export async function getCustomerTracking(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const orderId = orderIdSchema.safeParse(req.params.orderId);
  if (!orderId.success) throw new AppError("Invalid order ID", 400);
  if (!req.user) throw new AppError("Authentication required", 401);

  const tracking = await getCustomerOrderDeliveryTracking(
    orderId.data,
    req.user.id,
  );
  res.status(200).json({
    message: "Delivery tracking retrieved successfully",
    tracking,
  });
}

export async function getGuestTracking(
  req: Request,
  res: Response,
): Promise<void> {
  const orderId = orderIdSchema.safeParse(req.params.orderId);
  const token = guestTokenSchema.safeParse(req.get("x-guest-order-token"));

  if (!orderId.success || !token.success) {
    throw new AppError("Order not found", 404);
  }

  const tracking = await getGuestOrderDeliveryTracking(
    orderId.data,
    token.data,
  );
  res.status(200).json({
    message: "Delivery tracking retrieved successfully",
    tracking,
  });
}
