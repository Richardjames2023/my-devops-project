import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { createAuditLog } from "../../common/utils/audit-log";
import type { CreateCouponInput, UpdateCouponInput } from "./coupon.validation";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

function decimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function toMinorUnits(value: Prisma.Decimal): number {
  return Number(value.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString());
}

function fromMinorUnits(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value).div(100);
}

function hashCustomerKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function allocateDiscount<T extends { totalPrice: Prisma.Decimal }>(
  items: T[],
  discountMinor: number,
): Array<T & { discountAmount: Prisma.Decimal; totalPrice: Prisma.Decimal }> {
  const grossMinor = items.map((item) => toMinorUnits(item.totalPrice));
  const subtotalMinor = grossMinor.reduce((sum, amount) => sum + amount, 0);
  if (discountMinor <= 0 || subtotalMinor <= 0) {
    return items.map((item) => ({
      ...item,
      discountAmount: new Prisma.Decimal(0),
      totalPrice: item.totalPrice,
    }));
  }

  const shares = grossMinor.map((amount, index) => {
    const exact = (discountMinor * amount) / subtotalMinor;
    const floor = Math.floor(exact);
    return { index, floor, remainder: exact - floor };
  });
  let remaining = discountMinor - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < shares.length && remaining > 0; i++, remaining--) {
    shares[i]!.floor += 1;
  }
  const allocated = new Map(shares.map((share) => [share.index, share.floor]));

  return items.map((item, index) => {
    const lineDiscount = allocated.get(index) ?? 0;
    return {
      ...item,
      discountAmount: fromMinorUnits(lineDiscount),
      totalPrice: fromMinorUnits(grossMinor[index]! - lineDiscount),
    };
  });
}

export async function calculateCouponForOrder(
  tx: Prisma.TransactionClient,
  input: {
    code: string;
    subtotal: Prisma.Decimal;
    items: Array<{ totalPrice: Prisma.Decimal; [key: string]: unknown }>;
    customerKey: string;
  },
) {
  const code = input.code.trim().toUpperCase();
  const found = await tx.coupon.findUnique({ where: { code } });
  if (!found) throw new AppError("This coupon code is invalid", 422);

  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${found.id}::uuid FOR UPDATE`;
  const coupon = await tx.coupon.findUnique({ where: { id: found.id } });
  if (!coupon) throw new AppError("This coupon code is invalid", 422);

  const now = new Date();
  await tx.couponRedemption.updateMany({
    where: { couponId: coupon.id, status: "RESERVED", expiresAt: { lte: now } },
    data: { status: "RELEASED", releasedAt: now },
  });

  if (!coupon.isActive) throw new AppError("This coupon is no longer active", 422);
  if (coupon.startsAt && coupon.startsAt > now) throw new AppError("This coupon is not active yet", 422);
  if (coupon.expiresAt && coupon.expiresAt <= now) throw new AppError("This coupon has expired", 422);
  if (input.subtotal.lessThan(coupon.minimumSubtotal)) {
    throw new AppError(`A minimum subtotal of ${coupon.minimumSubtotal.toFixed(2)} is required for this coupon`, 422);
  }

  const customerKeyHash = hashCustomerKey(input.customerKey);
  const activeRedemptions = await tx.couponRedemption.findMany({
    where: { couponId: coupon.id, status: { in: ["RESERVED", "REDEEMED"] } },
    select: { customerKeyHash: true },
  });
  if (coupon.usageLimit !== null && activeRedemptions.length >= coupon.usageLimit) {
    throw new AppError("This coupon has reached its usage limit", 409);
  }
  const customerUses = activeRedemptions.filter((item) => item.customerKeyHash === customerKeyHash).length;
  if (coupon.perCustomerLimit !== null && customerUses >= coupon.perCustomerLimit) {
    throw new AppError("You have reached the usage limit for this coupon", 409);
  }

  let discount = coupon.discountType === "PERCENTAGE"
    ? input.subtotal.mul(coupon.discountValue).div(100)
    : coupon.discountValue;
  if (coupon.maxDiscountAmount && discount.greaterThan(coupon.maxDiscountAmount)) {
    discount = coupon.maxDiscountAmount;
  }
  if (discount.greaterThan(input.subtotal)) discount = input.subtotal;
  discount = new Prisma.Decimal(fromMinorUnits(toMinorUnits(discount)).toFixed(2));

  const allocatedItems = allocateDiscount(
    input.items as Array<{ totalPrice: Prisma.Decimal; [key: string]: unknown }>,
    toMinorUnits(discount),
  );

  return {
    coupon,
    customerKeyHash,
    discountAmount: discount,
    items: allocatedItems,
    expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
  };
}

export async function createCoupon(input: CreateCouponInput, staffAccountId: string, metadata: { ipAddress?: string; userAgent?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({
      data: {
        code: input.code,
        description: input.description ?? null,
        discountType: input.discountType,
        discountValue: decimal(input.discountValue),
        maxDiscountAmount: input.maxDiscountAmount ? decimal(input.maxDiscountAmount) : null,
        minimumSubtotal: decimal(input.minimumSubtotal ?? "0"),
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        isActive: input.isActive ?? true,
      },
    });
    await createAuditLog(tx, {
      staffAccountId, action: "COUPON_CREATED", entity: "Coupon", entityId: coupon.id,
      newValues: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue.toString() },
      ...metadata,
    });
    return coupon;
  });
}

export async function listCoupons(query: { page: number; limit: number; active?: "true" | "false" }) {
  const where: Prisma.CouponWhereInput = query.active === undefined ? {} : { isActive: query.active === "true" };
  const [coupons, total] = await prisma.$transaction([
    prisma.coupon.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.coupon.count({ where }),
  ]);
  return { coupons, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getCoupon(couponId: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id: couponId },
    include: { _count: { select: { redemptions: true } } },
  });
  if (!coupon) throw new AppError("Coupon not found", 404);
  return coupon;
}

export async function updateCoupon(couponId: string, input: UpdateCouponInput, staffAccountId: string, metadata: { ipAddress?: string; userAgent?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.coupon.findUnique({ where: { id: couponId } });
    if (!existing) throw new AppError("Coupon not found", 404);
    const data: Prisma.CouponUpdateInput = {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
      ...(input.discountValue !== undefined ? { discountValue: decimal(input.discountValue) } : {}),
      ...(input.maxDiscountAmount !== undefined ? { maxDiscountAmount: input.maxDiscountAmount === null ? null : decimal(input.maxDiscountAmount) } : {}),
      ...(input.minimumSubtotal !== undefined ? { minimumSubtotal: decimal(input.minimumSubtotal) } : {}),
      ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
      ...(input.perCustomerLimit !== undefined ? { perCustomerLimit: input.perCustomerLimit } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt === null ? null : new Date(input.startsAt) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const updated = await tx.coupon.update({ where: { id: couponId }, data });
    await createAuditLog(tx, {
      staffAccountId, action: "COUPON_UPDATED", entity: "Coupon", entityId: couponId,
      oldValues: { code: existing.code, isActive: existing.isActive, discountType: existing.discountType, discountValue: existing.discountValue.toString() },
      newValues: { code: updated.code, isActive: updated.isActive, discountType: updated.discountType, discountValue: updated.discountValue.toString() },
      ...metadata,
    });
    return updated;
  });
}
