import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  addWishlistItem,
  getWishlist,
  removeWishlistItem,
} from "./wishlist.service";
import { addWishlistItemSchema } from "./wishlist.validation";

function getCustomerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }
  return req.user.id;
}

export async function get(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const wishlist = await getWishlist(getCustomerId(req));
  res.status(200).json({
    message: "Wishlist retrieved successfully",
    wishlist,
  });
}

export async function add(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = addWishlistItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const wishlist = await addWishlistItem(getCustomerId(req), parsed.data.productId);
  res.status(200).json({
    message: "Product added to wishlist successfully",
    wishlist,
  });
}

export async function remove(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const productId = req.params.productId;
  if (typeof productId !== "string" || !z.uuid().safeParse(productId).success) {
    res.status(400).json({ message: "Invalid product ID" });
    return;
  }

  const wishlist = await removeWishlistItem(getCustomerId(req), productId);
  res.status(200).json({
    message: "Product removed from wishlist successfully",
    wishlist,
  });
}
