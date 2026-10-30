import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { GuestSessionRequest } from "../guest-session/guest-session.middleware";
import { addCartItemSchema, updateCartItemSchema } from "./cart.validation";
import {
  getGuestCart,
  addGuestCartItem,
  updateGuestCartItem,
  removeGuestCartItem,
  clearGuestCart,
} from "./cart.service";

function getGuestSessionId(req: GuestSessionRequest): string {
  if (!req.guestSessionId) {
    throw new AppError("Guest session required", 401);
  }

  return req.guestSessionId;
}

export async function getGuestCartController(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const cart = await getGuestCart(getGuestSessionId(req));

  res.status(200).json({
    message: "Guest cart retrieved successfully",
    cart,
  });
}

export async function addGuestCartItemController(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const result = addCartItemSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const cart = await addGuestCartItem(getGuestSessionId(req), result.data);

  res.status(200).json({
    message: "Guest cart item added successfully",
    cart,
  });
}

export async function updateGuestCartItemController(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const result = updateCartItemSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const itemId = req.params.itemId;

  if (typeof itemId !== "string" || !z.uuid().safeParse(itemId).success) {
    res.status(400).json({ message: "Invalid cart item ID" });
    return;
  }

  const cart = await updateGuestCartItem(
    getGuestSessionId(req),
    itemId,
    result.data,
  );

  res.status(200).json({
    message: "Guest cart item updated successfully",
    cart,
  });
}

export async function removeGuestCartItemController(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const itemId = req.params.itemId;

  if (typeof itemId !== "string" || !z.uuid().safeParse(itemId).success) {
    res.status(400).json({ message: "Invalid cart item ID" });
    return;
  }

  const cart = await removeGuestCartItem(getGuestSessionId(req), itemId);

  res.status(200).json({
    message: "Guest cart item removed successfully",
    cart,
  });
}

export async function clearGuestCartController(
  req: GuestSessionRequest,
  res: Response,
): Promise<void> {
  const cart = await clearGuestCart(getGuestSessionId(req));

  res.status(200).json({
    message: "Guest cart cleared successfully",
    cart,
  });
}
