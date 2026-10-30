import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { addCartItemSchema, updateCartItemSchema } from "./cart.validation";
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} from "./cart.service";

function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  return req.user.id;
}

export async function get(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const cart = await getCart(getAuthenticatedUserId(req));

  res.status(200).json({
    message: "Cart retrieved successfully",
    cart,
  });
}

export async function addItem(
  req: AuthenticatedRequest,
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

  const cart = await addCartItem(getAuthenticatedUserId(req), result.data);

  res.status(200).json({
    message: "Cart item added successfully",
    cart,
  });
}

export async function updateItem(
  req: AuthenticatedRequest,
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
    res.status(400).json({
      message: "Invalid cart item ID",
    });
    return;
  }

  const cart = await updateCartItem(
    getAuthenticatedUserId(req),
    itemId,
    result.data,
  );

  res.status(200).json({
    message: "Cart item updated successfully",
    cart,
  });
}

export async function removeItem(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const itemId = req.params.itemId;

  if (typeof itemId !== "string" || !z.uuid().safeParse(itemId).success) {
    res.status(400).json({
      message: "Invalid cart item ID",
    });
    return;
  }

  const cart = await removeCartItem(getAuthenticatedUserId(req), itemId);

  res.status(200).json({
    message: "Cart item removed successfully",
    cart,
  });
}

export async function clear(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const cart = await clearCart(getAuthenticatedUserId(req));

  res.status(200).json({
    message: "Cart cleared successfully",
    cart,
  });
}
