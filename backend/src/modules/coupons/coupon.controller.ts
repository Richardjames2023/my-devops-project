import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { createCouponSchema, couponListQuerySchema, updateCouponSchema } from "./coupon.validation";
import { createCoupon, getCoupon, listCoupons, updateCoupon } from "./coupon.service";

function staffActor(req: AuthenticatedRequest): string {
  if (!req.user || req.user.identityType !== "STAFF") throw new AppError("Staff authentication required", 401);
  return req.user.id;
}
function metadata(req: AuthenticatedRequest) {
  return {
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(req.get("user-agent") ? { userAgent: req.get("user-agent")! } : {}),
  };
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = createCouponSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const coupon = await createCoupon(parsed.data, staffActor(req), metadata(req));
  res.status(201).json({ message: "Coupon created successfully", coupon });
}

export async function list(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = couponListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  res.status(200).json({ message: "Coupons retrieved successfully", ...await listCoupons(parsed.data) });
}

export async function getById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = z.object({ couponId: z.uuid() }).safeParse(req.params);
  if (!parsed.success) throw new AppError("Invalid coupon ID", 400);
  res.status(200).json({ message: "Coupon retrieved successfully", coupon: await getCoupon(parsed.data.couponId) });
}

export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const params = z.object({ couponId: z.uuid() }).safeParse(req.params);
  const body = updateCouponSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ message: "Validation failed", errors: {
      ...(!params.success ? z.flattenError(params.error).fieldErrors : {}),
      ...(!body.success ? z.flattenError(body.error).fieldErrors : {}),
    } });
    return;
  }
  const coupon = await updateCoupon(params.data.couponId, body.data, staffActor(req), metadata(req));
  res.status(200).json({ message: "Coupon updated successfully", coupon });
}
