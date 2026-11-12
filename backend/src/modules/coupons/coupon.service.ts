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
  return Number(
    value.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString(),
  );
}

function fromMinorUnits(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value).div(100);
}

function hashCustomerKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
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

  const totalMinor = BigInt(subtotalMinor);
  const discountMinorBig = BigInt(discountMinor);
  const shares = grossMinor.map((amount, index) => {
    const product = discountMinorBig * BigInt(amount);
    return {
      index,
      floor: product / totalMinor,
      remainder: product % totalMinor,
    };
  });
  let remaining =
    discountMinorBig - shares.reduce((sum, share) => sum + share.floor, 0n);
  shares.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; i < shares.length && remaining > 0n; i++, remaining--) {
    shares[i]!.floor += 1n;
  }
  const allocated = new Map(
    shares.map((share) => [share.index, Number(share.floor)]),
  );

  return items.map((item, index) => {
    const lineDiscount = allocated.get(index) ?? 0;
    return {
      ...item,
      discountAmount: fromMinorUnits(lineDiscount),
      totalPrice: fromMinorUnits(grossMinor[index]! - lineDiscount),
    };
  });
}

export async function calculateCouponForOrder<
  T extends { totalPrice: Prisma.Decimal },
>(
  tx: Prisma.TransactionClient,
  input: {
    code: string;
    subtotal: Prisma.Decimal;
    items: T[];
    customerKey: string;
  },
) {
  const code = input.code.trim().toUpperCase();
  const found = await tx.coupon.findUnique({ where: { code } });
  if (!found) throw new AppError("This coupon code is invalid", 422);

  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${found.id}::uuid FOR UPDATE`;
  const coupon = await tx.coupon.findUnique({ where: { id: found.id } });
  if (!coupon || coupon.code !== code)
    throw new AppError("This coupon code is invalid", 422);

  const now = new Date();

  await tx.$executeRaw`
  UPDATE coupon_redemptions
  SET
    status = 'RELEASED',
    "releasedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE
    "couponId" = ${coupon.id}::uuid
    AND status = 'RESERVED'
    AND "expiresAt" <= CURRENT_TIMESTAMP
`;

  if (!coupon.isActive)
    throw new AppError("This coupon is no longer active", 422);
  if (coupon.startsAt && coupon.startsAt > now)
    throw new AppError("This coupon is not active yet", 422);
  if (coupon.expiresAt && coupon.expiresAt <= now)
    throw new AppError("This coupon has expired", 422);
  if (input.subtotal.lessThan(coupon.minimumSubtotal)) {
    throw new AppError(
      `A minimum subtotal of ${coupon.minimumSubtotal.toFixed(2)} is required for this coupon`,
      422,
    );
  }

  const customerKeyHash = hashCustomerKey(input.customerKey);
  const activeRedemptions = await tx.couponRedemption.findMany({
    where: { couponId: coupon.id, status: { in: ["RESERVED", "REDEEMED"] } },
    select: { customerKeyHash: true },
  });
  if (
    coupon.usageLimit !== null &&
    activeRedemptions.length >= coupon.usageLimit
  ) {
    throw new AppError("This coupon has reached its usage limit", 409);
  }
  const customerUses = activeRedemptions.filter(
    (item) => item.customerKeyHash === customerKeyHash,
  ).length;
  if (
    coupon.perCustomerLimit !== null &&
    customerUses >= coupon.perCustomerLimit
  ) {
    throw new AppError("You have reached the usage limit for this coupon", 409);
  }

  let discount =
    coupon.discountType === "PERCENTAGE"
      ? input.subtotal.mul(coupon.discountValue).div(100)
      : coupon.discountValue;
  if (
    coupon.maxDiscountAmount &&
    discount.greaterThan(coupon.maxDiscountAmount)
  ) {
    discount = coupon.maxDiscountAmount;
  }
  if (discount.greaterThan(input.subtotal)) discount = input.subtotal;
  discount = new Prisma.Decimal(
    fromMinorUnits(toMinorUnits(discount)).toFixed(2),
  );
  if (toMinorUnits(discount) <= 0) {
    throw new AppError(
      "This coupon discount is smaller than the minimum currency unit",
      422,
    );
  }

  const allocatedItems = allocateDiscount(input.items, toMinorUnits(discount));

  return {
    coupon,
    customerKeyHash,
    discountAmount: discount,
    items: allocatedItems,
    expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
  };
}

export async function createCoupon(
  input: CreateCouponInput,
  staffAccountId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: {
          code: input.code,
          description: input.description ?? null,
          discountType: input.discountType,
          discountValue: decimal(input.discountValue),
          maxDiscountAmount: input.maxDiscountAmount
            ? decimal(input.maxDiscountAmount)
            : null,
          minimumSubtotal: decimal(input.minimumSubtotal ?? "0"),
          usageLimit: input.usageLimit ?? null,
          perCustomerLimit: input.perCustomerLimit ?? null,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          isActive: input.isActive ?? true,
        },
      });
      await createAuditLog(tx, {
        staffAccountId,
        action: "COUPON_CREATED",
        entity: "Coupon",
        entityId: coupon.id,
        newValues: {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue.toString(),
        },
        ...metadata,
      });
      return coupon;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("A coupon with this code already exists", 409);
    }
    throw error;
  }
}

export async function listCoupons(query: {
  page: number;
  limit: number;
  active?: "true" | "false";
}) {
  const where: Prisma.CouponWhereInput =
    query.active === undefined ? {} : { isActive: query.active === "true" };
  const [coupons, total] = await prisma.$transaction([
    prisma.coupon.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.coupon.count({ where }),
  ]);
  return {
    coupons,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getCoupon(couponId: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id: couponId },
    include: { _count: { select: { redemptions: true } } },
  });
  if (!coupon) throw new AppError("Coupon not found", 404);
  return coupon;
}

export async function updateCoupon(
  couponId: string,
  input: UpdateCouponInput,
  staffAccountId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${couponId}::uuid FOR UPDATE`;
      const existing = await tx.coupon.findUnique({ where: { id: couponId } });
      if (!existing) throw new AppError("Coupon not found", 404);

      await tx.$executeRaw`
        UPDATE coupon_redemptions
        SET
          status = 'RELEASED',
          "releasedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE
          "couponId" = ${couponId}::uuid
          AND status = 'RESERVED'
          AND "expiresAt" <= CURRENT_TIMESTAMP
      `;

      const nextType = input.discountType ?? existing.discountType;
      const nextValue =
        input.discountValue !== undefined
          ? decimal(input.discountValue)
          : existing.discountValue;
      if (
        nextValue.lessThanOrEqualTo(0) ||
        (nextType === "PERCENTAGE" && nextValue.greaterThan(100))
      ) {
        throw new AppError(
          "The discount value is invalid for the selected discount type",
          400,
        );
      }

      const nextStartsAt =
        input.startsAt !== undefined
          ? input.startsAt === null
            ? null
            : new Date(input.startsAt)
          : existing.startsAt;
      const nextExpiresAt =
        input.expiresAt !== undefined
          ? input.expiresAt === null
            ? null
            : new Date(input.expiresAt)
          : existing.expiresAt;
      if (nextStartsAt && nextExpiresAt && nextExpiresAt <= nextStartsAt) {
        throw new AppError(
          "Coupon expiry must be later than its start date",
          400,
        );
      }

      if (input.usageLimit !== undefined && input.usageLimit !== null) {
        const activeUsage = await tx.couponRedemption.count({
          where: { couponId, status: { in: ["RESERVED", "REDEEMED"] } },
        });
        if (input.usageLimit < activeUsage) {
          throw new AppError(
            "Usage limit cannot be lower than existing active reservations and redemptions",
            409,
          );
        }
      }

      const data: Prisma.CouponUpdateInput = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.discountType !== undefined
          ? { discountType: input.discountType }
          : {}),
        ...(input.discountValue !== undefined
          ? { discountValue: decimal(input.discountValue) }
          : {}),
        ...(input.maxDiscountAmount !== undefined
          ? {
              maxDiscountAmount:
                input.maxDiscountAmount === null
                  ? null
                  : decimal(input.maxDiscountAmount),
            }
          : {}),
        ...(input.minimumSubtotal !== undefined
          ? { minimumSubtotal: decimal(input.minimumSubtotal) }
          : {}),
        ...(input.usageLimit !== undefined
          ? { usageLimit: input.usageLimit }
          : {}),
        ...(input.perCustomerLimit !== undefined
          ? { perCustomerLimit: input.perCustomerLimit }
          : {}),
        ...(input.startsAt !== undefined
          ? {
              startsAt:
                input.startsAt === null ? null : new Date(input.startsAt),
            }
          : {}),
        ...(input.expiresAt !== undefined
          ? {
              expiresAt:
                input.expiresAt === null ? null : new Date(input.expiresAt),
            }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      const updated = await tx.coupon.update({ where: { id: couponId }, data });
      await createAuditLog(tx, {
        staffAccountId,
        action: "COUPON_UPDATED",
        entity: "Coupon",
        entityId: couponId,
        oldValues: {
          code: existing.code,
          isActive: existing.isActive,
          discountType: existing.discountType,
          discountValue: existing.discountValue.toString(),
        },
        newValues: {
          code: updated.code,
          isActive: updated.isActive,
          discountType: updated.discountType,
          discountValue: updated.discountValue.toString(),
        },
        ...metadata,
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("A coupon with this code already exists", 409);
    }
    throw error;
  }
}
