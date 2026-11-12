import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: coupon tests may only use shop_db_test",
  );
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const {
  calculateCouponForOrder,
  hashCouponCustomerKey,
  updateCoupon,
  disconnectDatabase,
  Prisma,
} =
  await import("../src/modules/coupons/coupon.service").then(
    async (service) => {
      const database = await import("../src/infrastructure/prisma/client");
      const prismaTypes = await import("@prisma/client");
      return {
        calculateCouponForOrder: service.calculateCouponForOrder,
        updateCoupon: service.updateCoupon,
        disconnectDatabase: database.disconnectDatabase,
        Prisma: prismaTypes.Prisma,
      };
    },
  );

interface Fixture {
  couponId: string;
  couponCode: string;
  orderIds: string[];
}

async function createCouponFixture(
  options: {
    discountType?: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue?: string;
    usageLimit?: number | null;
    perCustomerLimit?: number | null;
    maxDiscountAmount?: string | null;
    minimumSubtotal?: string;
  } = {},
): Promise<Fixture> {
  const id = randomUUID();
  const fixture: Fixture = {
    couponId: id,
    couponCode: `COUPON-${id.replace(/-/g, "").slice(0, 16).toUpperCase()}`,
    orderIds: [],
  };
  await pool.query(
    `INSERT INTO coupons
      (id, code, "discountType", "discountValue", "maxDiscountAmount", "minimumSubtotal",
       "usageLimit", "perCustomerLimit", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())`,
    [
      fixture.couponId,
      fixture.couponCode,
      options.discountType ?? "PERCENTAGE",
      options.discountValue ?? "10.00",
      options.maxDiscountAmount ?? null,
      options.minimumSubtotal ?? "0",
      options.usageLimit ?? null,
      options.perCustomerLimit ?? null,
    ],
  );
  return fixture;
}

async function addRedemption(
  fixture: Fixture,
  customerKeyHash: string,
  expiresAt: Date | null = null,
): Promise<void> {
  const orderId = randomUUID();
  fixture.orderIds.push(orderId);
  await pool.query(
    `INSERT INTO orders
      (id, "orderNumber", status, subtotal, "deliveryFee", "totalAmount",
       currency, "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, 'PENDING', 100, 0, 100, 'NGN', '{}'::jsonb, NOW(), NOW())`,
    [orderId, `COUPON-ORDER-${orderId}`],
  );
  await pool.query(
    `INSERT INTO coupon_redemptions
      (id, "couponId", "orderId", "customerKeyHash", "discountAmount",
       status, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 10, 'RESERVED', $5, NOW(), NOW())`,
    [randomUUID(), fixture.couponId, orderId, customerKeyHash, expiresAt],
  );
}

async function cleanup(fixture: Fixture): Promise<void> {
  await pool.query(`DELETE FROM coupon_redemptions WHERE "couponId" = $1`, [
    fixture.couponId,
  ]);
  if (fixture.orderIds.length) {
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
      fixture.orderIds,
    ]);
  }
  await pool.query(`DELETE FROM coupons WHERE id = $1`, [fixture.couponId]);
}

describe("PostgreSQL coupon calculation and reservation limits", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
  });

  it("calculates percentage discounts and allocates every kobo across line items", async () => {
    const fixture = await createCouponFixture({
      discountType: "PERCENTAGE",
      discountValue: "12.50",
    });
    try {
      const result = await import("../src/infrastructure/prisma/client").then(
        ({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:test-customer",
              items: [
                { name: "First", totalPrice: new Prisma.Decimal("33.33") },
                { name: "Second", totalPrice: new Prisma.Decimal("66.67") },
              ],
            }),
          ),
      );
      expect(result.discountAmount.toFixed(2)).toBe("12.50");
      expect(
        result.items
          .reduce(
            (sum, item) => sum.plus(item.discountAmount),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
      ).toBe("12.50");
      expect(
        result.items
          .reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
      ).toBe("87.50");
    } finally {
      await cleanup(fixture);
    }
  });

  it("calculates fixed-amount discounts", async () => {
    const fixture = await createCouponFixture({
      discountType: "FIXED_AMOUNT",
      discountValue: "25.00",
    });
    try {
      const result = await import("../src/infrastructure/prisma/client").then(
        ({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:fixed-discount",
              items: [
                { totalPrice: new Prisma.Decimal("40.00") },
                { totalPrice: new Prisma.Decimal("60.00") },
              ],
            }),
          ),
      );
      expect(result.discountAmount.toFixed(2)).toBe("25.00");
      expect(result.items.reduce((sum, item) => sum.plus(item.discountAmount), new Prisma.Decimal(0)).toFixed(2)).toBe("25.00");
    } finally {
      await cleanup(fixture);
    }
  });

  it("caps percentage discounts at maxDiscountAmount", async () => {
    const fixture = await createCouponFixture({
      discountType: "PERCENTAGE",
      discountValue: "50.00",
      maxDiscountAmount: "15.00",
    });
    try {
      const result = await import("../src/infrastructure/prisma/client").then(
        ({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:capped-discount",
              items: [{ totalPrice: new Prisma.Decimal("100.00") }],
            }),
          ),
      );
      expect(result.discountAmount.toFixed(2)).toBe("15.00");
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects orders below the coupon minimum subtotal", async () => {
    const fixture = await createCouponFixture({ minimumSubtotal: "150.00" });
    try {
      await expect(
        import("../src/infrastructure/prisma/client").then(
          ({ default: prisma }) =>
            prisma.$transaction((tx) =>
              calculateCouponForOrder(tx, {
                code: fixture.couponCode,
                subtotal: new Prisma.Decimal("100.00"),
                customerKey: "user:below-minimum",
                items: [{ totalPrice: new Prisma.Decimal("100.00") }],
              }),
            ),
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await cleanup(fixture);
    }
  });

  it("allows only one concurrent checkout to reserve the final coupon use", async () => {
    const fixture = await createCouponFixture({ usageLimit: 1 });
    const { default: prisma } = await import("../src/infrastructure/prisma/client");
    const attempt = (suffix: string) =>
      prisma.$transaction(async (tx) => {
        const result = await calculateCouponForOrder(tx, {
          code: fixture.couponCode,
          subtotal: new Prisma.Decimal("100.00"),
          customerKey: `user:concurrent-${suffix}`,
          items: [{ totalPrice: new Prisma.Decimal("100.00") }],
        });
        const orderId = randomUUID();
        await tx.order.create({
          data: {
            id: orderId,
            orderNumber: `COUPON-CONCURRENT-${orderId}`,
            status: "PENDING",
            subtotal: new Prisma.Decimal("100.00"),
            deliveryFee: new Prisma.Decimal("0.00"),
            totalAmount: new Prisma.Decimal("90.00"),
            currency: "NGN",
            shippingAddress: {},
          },
        });
        await tx.couponRedemption.create({
          data: {
            couponId: fixture.couponId,
            orderId,
            customerKeyHash: result.customerKeyHash,
            discountAmount: result.discountAmount,
            status: "RESERVED",
          },
        });
        fixture.orderIds.push(orderId);
        return orderId;
      });
    try {
      const results = await Promise.allSettled([attempt("one"), attempt("two")]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const redemptionCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM coupon_redemptions
         WHERE "couponId" = $1 AND status IN ('RESERVED', 'REDEEMED')`,
        [fixture.couponId],
      );
      expect(redemptionCount.rows[0].count).toBe(1);
    } finally {
      await cleanup(fixture);
    }
  });

  it("uses a keyed, normalized HMAC for customer identifiers", () => {
    const first = hashCouponCustomerKey(" Guest:Example@Email.com ");
    const normalized = hashCouponCustomerKey("guest:example@email.com");
    const different = hashCouponCustomerKey("guest:other@email.com");
    expect(first).toBe(normalized);
    expect(first).not.toBe(different);
    expect(first).not.toBe(
      createHash("sha256").update("guest:example@email.com").digest("hex"),
    );
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces the total usage limit against active reservations", async () => {
    const fixture = await createCouponFixture({ usageLimit: 1 });
    try {
      await addRedemption(
        fixture,
        hashCouponCustomerKey("user:someone-else"),
      );
      await expect(
        import("../src/infrastructure/prisma/client").then(
          ({ default: prisma }) =>
            prisma.$transaction((tx) =>
              calculateCouponForOrder(tx, {
                code: fixture.couponCode,
                subtotal: new Prisma.Decimal("100.00"),
                customerKey: "user:new-customer",
                items: [{ totalPrice: new Prisma.Decimal("100.00") }],
              }),
            ),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await cleanup(fixture);
    }
  });

  it("releases expired reservations before enforcing usage limits", async () => {
    const fixture = await createCouponFixture({ usageLimit: 1 });
    try {
      await addRedemption(
        fixture,
        hashCouponCustomerKey("user:old-customer"),
        new Date(Date.now() - 60_000),
      );

      const result = await import("../src/infrastructure/prisma/client").then(
        ({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:new-customer",
              items: [{ totalPrice: new Prisma.Decimal("100.00") }],
            }),
          ),
      );
      expect(result.discountAmount.toFixed(2)).toBe("10.00");
      const status = await pool.query(
        `SELECT status FROM coupon_redemptions WHERE "couponId" = $1`,
        [fixture.couponId],
      );
      expect(status.rows[0]?.status).toBe("RELEASED");
    } finally {
      await cleanup(fixture);
    }
  });

  it("releases expired reservations before lowering a coupon usage limit", async () => {
    const fixture = await createCouponFixture({ usageLimit: 2 });
    const staffAccountId = randomUUID();

    try {
      await pool.query(
        `INSERT INTO staff_accounts
          (id, email, "firstName", "lastName", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Coupon', 'Test', NOW(), NOW())`,
        [staffAccountId, `coupon-test-${staffAccountId}@example.com`],
      );

      await addRedemption(
        fixture,
        hashCouponCustomerKey("user:expired-customer"),
        new Date(Date.now() - 60_000),
      );
      await addRedemption(
        fixture,
        hashCouponCustomerKey("user:active-customer"),
      );

      const updated = await updateCoupon(
        fixture.couponId,
        { usageLimit: 1 },
        staffAccountId,
      );

      expect(updated.usageLimit).toBe(1);

      const result = await pool.query(
        `SELECT status
         FROM coupon_redemptions
         WHERE "couponId" = $1
         ORDER BY status`,
        [fixture.couponId],
      );

      expect(result.rows.map((row) => row.status).sort()).toEqual([
        "RELEASED",
        "RESERVED",
      ]);
    } finally {
      await pool.query(
        `DELETE FROM audit_logs WHERE entity = 'Coupon' AND "entityId" = $1`,
        [fixture.couponId],
      );
      await pool.query(`DELETE FROM staff_accounts WHERE id = $1`, [
        staffAccountId,
      ]);
      await cleanup(fixture);
    }
  });

  it("enforces per-customer usage limits using the normalized customer key", async () => {
    const fixture = await createCouponFixture({ perCustomerLimit: 1 });
    const customerKey = "user:customer-one";
    try {
      await addRedemption(
        fixture,
        hashCouponCustomerKey(customerKey),
      );
      await expect(
        import("../src/infrastructure/prisma/client").then(
          ({ default: prisma }) =>
            prisma.$transaction((tx) =>
              calculateCouponForOrder(tx, {
                code: fixture.couponCode.toLowerCase(),
                subtotal: new Prisma.Decimal("100.00"),
                customerKey: customerKey.toUpperCase(),
                items: [{ totalPrice: new Prisma.Decimal("100.00") }],
              }),
            ),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects a coupon before its start time using the database clock", async () => {
    const fixture = await createCouponFixture();
    try {
      await pool.query(
        `UPDATE coupons
         SET "startsAt" = NOW() + INTERVAL '5 minutes'
         WHERE id = $1`,
        [fixture.couponId],
      );

      await expect(
        import("../src/infrastructure/prisma/client").then(({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:future-coupon",
              items: [{ totalPrice: new Prisma.Decimal("100.00") }],
            }),
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await cleanup(fixture);
    }
  });

  it("rejects a coupon after its expiry time using the database clock", async () => {
    const fixture = await createCouponFixture();
    try {
      await pool.query(
        `UPDATE coupons
         SET "expiresAt" = NOW() - INTERVAL '5 minutes'
         WHERE id = $1`,
        [fixture.couponId],
      );

      await expect(
        import("../src/infrastructure/prisma/client").then(({ default: prisma }) =>
          prisma.$transaction((tx) =>
            calculateCouponForOrder(tx, {
              code: fixture.couponCode,
              subtotal: new Prisma.Decimal("100.00"),
              customerKey: "user:expired-coupon",
              items: [{ totalPrice: new Prisma.Decimal("100.00") }],
            }),
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await cleanup(fixture);
    }
  });

});
