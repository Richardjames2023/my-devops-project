import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const paystackMocks = vi.hoisted(() => ({
  createRefund: vi.fn(),
  fetchRefund: vi.fn(),
  listRefunds: vi.fn(),
}));

vi.mock("../src/modules/payment/paystack.client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/modules/payment/paystack.client")
    >();

  return {
    ...actual,
    createPaystackRefund: paystackMocks.createRefund,
    fetchPaystackRefund: paystackMocks.fetchRefund,
    listPaystackRefunds: paystackMocks.listRefunds,
  };
});

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated shop_db_test database.",
  );
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: refund tests may only use shop_db_test.",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

const { default: prisma } = await import("../src/infrastructure/prisma/client");

const { resolveReconciliationAsRefunded, reconcileInventoryRefund } =
  await import("../src/modules/inventory-reconciliation/inventory-reconciliation.service");
interface TestFixture {
  userId: string;
  orderId: string;
  paymentId: string;
  reconciliationId: string;
}

async function createFixture(): Promise<TestFixture> {
  const fixture: TestFixture = {
    userId: randomUUID(),
    orderId: randomUUID(),
    paymentId: randomUUID(),
    reconciliationId: randomUUID(),
  };

  const suffix = randomUUID();

  try {
    await pool.query(
      `INSERT INTO users
        (id, email, "passwordHash", "firstName", "lastName",
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        fixture.userId,
        `${suffix}@refund-test.local`,
        "test-password-hash",
        "Refund",
        "Tester",
      ],
    );

    await pool.query(
      `INSERT INTO orders
        (id, "userId", "orderNumber", status, subtotal,
         "discountAmount", "deliveryFee", "totalAmount",
         currency, "shippingAddress", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'PENDING', 20000, 0, 0, 20000,
               'NGN', $4::jsonb, NOW(), NOW())`,
      [
        fixture.orderId,
        fixture.userId,
        `REFUND-ORDER-${suffix}`,
        JSON.stringify({
          fullName: "Refund Tester",
          address: "Test Address",
          city: "Gombe",
          state: "Gombe",
          country: "Nigeria",
        }),
      ],
    );

    await pool.query(
      `INSERT INTO payments
        (id, "orderId", reference, provider, status, amount, currency,
         "reconciliationRequired", "reconciliationReason",
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'PAYSTACK', 'SUCCESS', 20000, 'NGN',
               TRUE, 'Inventory finalization failed',
               NOW(), NOW())`,
      [fixture.paymentId, fixture.orderId, `PAYSTACK-REF-${suffix}`],
    );

    await pool.query(
      `INSERT INTO payment_inventory_reconciliations
        (id, "paymentId", "orderId", status, reason,
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'PENDING',
               'Inventory finalization failed', NOW(), NOW())`,
      [fixture.reconciliationId, fixture.paymentId, fixture.orderId],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function prepareRefundRecovery(
  fixture: TestFixture,
  options: {
    status?: string;
    providerReference?: string | null;
  } = {},
) {
  const refundId = randomUUID();
  const suffix = randomUUID();

  const status = options.status ?? "SUBMISSION_UNKNOWN";
  const providerReference = options.providerReference ?? null;

  await pool.query(
    `INSERT INTO refunds
      (id, "orderId", "paymentId", reference, status,
       amount, currency, reason, "providerReference",
       "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5,
             20000, 'NGN', 'Inventory refund recovery',
             $6, NOW(), NOW())`,
    [
      refundId,
      fixture.orderId,
      fixture.paymentId,
      `REFUND-RECOVERY-${suffix}`,
      status,
      providerReference,
    ],
  );

  await pool.query(
    `UPDATE payment_inventory_reconciliations
     SET status = 'REFUND_PENDING',
         "refundId" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [refundId, fixture.reconciliationId],
  );

  return {
    refundId,
    reference: `REFUND-RECOVERY-${suffix}`,
  };
}

async function cleanupFixture(fixture: TestFixture): Promise<void> {
  await pool.query(`DELETE FROM audit_logs WHERE "entityId" = $1`, [
    fixture.reconciliationId,
  ]);

  await pool.query(
    `DELETE FROM payment_inventory_reconciliations WHERE id = $1`,
    [fixture.reconciliationId],
  );

  await pool.query(`DELETE FROM refunds WHERE "paymentId" = $1`, [
    fixture.paymentId,
  ]);

  await pool.query(`DELETE FROM payments WHERE id = $1`, [fixture.paymentId]);

  await pool.query(`DELETE FROM orders WHERE id = $1`, [fixture.orderId]);

  await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
}

function successfulPaystackRefund() {
  return {
    id: 987654321,
    status: "processed",
    amount: 2000000,
    currency: "NGN",
    transaction: {
      id: 123456789,
      reference: "PAYSTACK-TEST-REFERENCE",
      currency: "NGN",
    },
  };
}

describe("PostgreSQL inventory refund reconciliation", () => {
  beforeEach(() => {
    paystackMocks.createRefund.mockReset();
    paystackMocks.fetchRefund.mockReset();
    paystackMocks.listRefunds.mockReset();
  });
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");

    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database.");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("recovers a successful Paystack refund and resolves inventory reconciliation", async () => {
    const fixture = await createFixture();

    try {
      await prepareRefundRecovery(fixture, {
        status: "SUBMISSION_UNKNOWN",
        providerReference: "987654321",
      });

      paystackMocks.fetchRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        id: 987654321,
        status: "processed",
      });

      const result = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(result.reconciled).toBe(true);
      expect(result.refund.status).toBe("SUCCESS");
      expect(result.refund.providerReference).toBe("987654321");
      expect(result.reconciliation.status).toBe("RESOLVED_REFUNDED");

      const payment = await pool.query(
        `SELECT "reconciliationRequired", "reconciliationReason",
          "reconciledAt"
         FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(false);
      expect(payment.rows[0].reconciliationReason).toBeNull();
      expect(payment.rows[0].reconciledAt).not.toBeNull();

      expect(paystackMocks.fetchRefund).toHaveBeenCalledTimes(1);
      expect(paystackMocks.createRefund).not.toHaveBeenCalled();

      const audit = await pool.query(
        `SELECT action FROM audit_logs WHERE "entityId" = $1`,
        [fixture.reconciliationId],
      );

      expect(audit.rows.map((row) => row.action)).toContain(
        "INVENTORY_RECONCILIATION_REFUND_RECOVERED",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not duplicate a successful refund recovery or audit log", async () => {
    const fixture = await createFixture();

    try {
      await prepareRefundRecovery(fixture, {
        status: "SUBMISSION_UNKNOWN",
        providerReference: "987654321",
      });

      paystackMocks.fetchRefund.mockResolvedValue(successfulPaystackRefund());

      const firstResult = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(firstResult.reconciled).toBe(true);
      expect(firstResult.reconciliation.status).toBe("RESOLVED_REFUNDED");

      const secondResult = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(secondResult.reconciliation.status).toBe("RESOLVED_REFUNDED");
      expect(secondResult.refund.status).toBe("SUCCESS");

      expect(paystackMocks.fetchRefund).toHaveBeenCalledTimes(1);
      expect(paystackMocks.createRefund).not.toHaveBeenCalled();

      const audit = await pool.query(
        `SELECT action FROM audit_logs
       WHERE "entityId" = $1
         AND action = 'INVENTORY_RECONCILIATION_REFUND_RECOVERED'`,
        [fixture.reconciliationId],
      );

      expect(audit.rows).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps reconciliation pending when Paystack refund is still processing", async () => {
    const fixture = await createFixture();

    try {
      await prepareRefundRecovery(fixture, {
        status: "SUBMISSION_UNKNOWN",
        providerReference: "987654321",
      });

      paystackMocks.fetchRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        id: 987654321,
        status: "processing",
      });

      const result = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(result.reconciled).toBe(false);
      expect(result.refund.status).toBe("PROCESSING");
      expect(result.reconciliation.status).toBe("REFUND_PENDING");

      const payment = await pool.query(
        `SELECT "reconciliationRequired"
       FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
      expect(paystackMocks.createRefund).not.toHaveBeenCalled();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns reconciliation to UNDER_REVIEW when Paystack refund fails", async () => {
    const fixture = await createFixture();

    try {
      const recovery = await prepareRefundRecovery(fixture, {
        status: "SUBMISSION_UNKNOWN",
        providerReference: "987654321",
      });

      paystackMocks.fetchRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        id: 987654321,
        status: "failed",
      });

      const result = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(result.reconciled).toBe(true);
      expect(result.refund.status).toBe("FAILED");
      expect(result.reconciliation.status).toBe("UNDER_REVIEW");

      const reconciliation = await pool.query(
        `SELECT status, "refundId"
       FROM payment_inventory_reconciliations
       WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("UNDER_REVIEW");
      expect(reconciliation.rows[0].refundId).toBe(recovery.refundId);

      const payment = await pool.query(
        `SELECT "reconciliationRequired"
       FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
      expect(paystackMocks.createRefund).not.toHaveBeenCalled();

      const audit = await pool.query(
        `SELECT action FROM audit_logs WHERE "entityId" = $1`,
        [fixture.reconciliationId],
      );

      expect(audit.rows.map((row) => row.action)).toContain(
        "INVENTORY_RECONCILIATION_REFUND_RECOVERY_FAILED",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("resolves reconciliation after a successful Paystack refund", async () => {
    const fixture = await createFixture();

    try {
      paystackMocks.createRefund.mockResolvedValue(successfulPaystackRefund());

      const result = await resolveReconciliationAsRefunded(
        fixture.reconciliationId,
        fixture.userId,
        "Refund customer due to inventory finalization failure",
      );

      expect(result.refund.status).toBe("SUCCESS");
      expect(result.refund.providerReference).toBe("987654321");
      expect(result.refund.amount.toString()).toBe("20000");

      expect(result.reconciliation.status).toBe("RESOLVED_REFUNDED");

      const payment = await pool.query(
        `SELECT "reconciliationRequired", "reconciliationReason",
                "reconciledAt"
         FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(false);
      expect(payment.rows[0].reconciliationReason).toBeNull();
      expect(payment.rows[0].reconciledAt).not.toBeNull();

      expect(paystackMocks.createRefund).toHaveBeenCalledTimes(1);

      expect(paystackMocks.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionReference: expect.stringContaining("PAYSTACK-REF-"),
          amountKobo: "2000000",
          currency: "NGN",
        }),
      );

      const audit = await pool.query(
        `SELECT action FROM audit_logs
         WHERE "entityId" = $1`,
        [fixture.reconciliationId],
      );

      expect(audit.rows.map((row) => row.action)).toContain(
        "INVENTORY_RECONCILIATION_REFUND_STARTED",
      );

      expect(audit.rows.map((row) => row.action)).toContain(
        "INVENTORY_RECONCILIATION_REFUND_COMPLETED",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("marks the refund SUBMISSION_UNKNOWN when Paystack throws", async () => {
    const fixture = await createFixture();

    try {
      paystackMocks.createRefund.mockRejectedValue(
        new Error("Paystack request timed out"),
      );

      await expect(
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Refund after inventory failure",
        ),
      ).rejects.toThrow(/uncertain Paystack outcome/i);

      const refund = await pool.query(
        `SELECT status FROM refunds WHERE "paymentId" = $1`,
        [fixture.paymentId],
      );

      expect(refund.rows).toHaveLength(1);
      expect(refund.rows[0].status).toBe("SUBMISSION_UNKNOWN");

      const reconciliation = await pool.query(
        `SELECT status, "refundId"
         FROM payment_inventory_reconciliations
         WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("REFUND_PENDING");
      expect(reconciliation.rows[0].refundId).not.toBeNull();

      const payment = await pool.query(
        `SELECT "reconciliationRequired"
         FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns reconciliation to UNDER_REVIEW when Paystack refund is cancelled", async () => {
    const fixture = await createFixture();

    try {
      const recovery = await prepareRefundRecovery(fixture, {
        status: "SUBMISSION_UNKNOWN",
        providerReference: "987654321",
      });

      paystackMocks.fetchRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        id: 987654321,
        status: "cancelled",
      });

      const result = await reconcileInventoryRefund(
        fixture.reconciliationId,
        fixture.userId,
      );

      expect(result.reconciled).toBe(true);
      expect(result.refund.status).toBe("CANCELLED");
      expect(result.reconciliation.status).toBe("UNDER_REVIEW");

      const reconciliation = await pool.query(
        `SELECT status, "refundId"
       FROM payment_inventory_reconciliations
       WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("UNDER_REVIEW");
      expect(reconciliation.rows[0].refundId).toBe(recovery.refundId);

      const payment = await pool.query(
        `SELECT "reconciliationRequired"
       FROM payments WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
      expect(paystackMocks.createRefund).not.toHaveBeenCalled();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not submit another refund when an active refund already exists", async () => {
    const fixture = await createFixture();

    try {
      await pool.query(
        `INSERT INTO refunds
          (id, "orderId", "paymentId", reference, status,
           amount, currency, reason, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'PROCESSING',
                 20000, 'NGN', 'Existing refund', NOW(), NOW())`,
        [
          randomUUID(),
          fixture.orderId,
          fixture.paymentId,
          `EXISTING-REFUND-${randomUUID()}`,
        ],
      );

      await expect(
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Attempt another refund",
        ),
      ).rejects.toThrow(/active or completed refund already exists/i);

      expect(paystackMocks.createRefund).not.toHaveBeenCalled();

      const reconciliation = await pool.query(
        `SELECT status FROM payment_inventory_reconciliations
         WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("PENDING");

      const refunds = await pool.query(
        `SELECT id FROM refunds WHERE "paymentId" = $1`,
        [fixture.paymentId],
      );

      expect(refunds.rows).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("allows only one Paystack refund submission under concurrent attempts", async () => {
    const fixture = await createFixture();

    try {
      paystackMocks.createRefund.mockImplementation(async () => {
        // Keep the first request in progress briefly so the second
        // request attempts to claim the same reconciliation.
        await new Promise((resolve) => setTimeout(resolve, 100));

        return successfulPaystackRefund();
      });

      const attempts = await Promise.allSettled([
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Concurrent refund attempt one",
        ),
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Concurrent refund attempt two",
        ),
      ]);

      const successfulAttempts = attempts.filter(
        (attempt) => attempt.status === "fulfilled",
      );

      const rejectedAttempts = attempts.filter(
        (attempt) => attempt.status === "rejected",
      );

      expect(successfulAttempts).toHaveLength(1);
      expect(rejectedAttempts).toHaveLength(1);

      expect(paystackMocks.createRefund).toHaveBeenCalledTimes(1);

      const refunds = await pool.query(
        `SELECT id, status FROM refunds WHERE "paymentId" = $1`,
        [fixture.paymentId],
      );

      expect(refunds.rows).toHaveLength(1);
      expect(refunds.rows[0].status).toBe("SUCCESS");

      const reconciliation = await pool.query(
        `SELECT status FROM payment_inventory_reconciliations
       WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("RESOLVED_REFUNDED");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("marks the refund SUBMISSION_UNKNOWN when Paystack returns an incorrect amount", async () => {
    const fixture = await createFixture();

    try {
      paystackMocks.createRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        amount: 1500000, // Expected: 2000000 kobo
      });

      await expect(
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Refund after inventory failure",
        ),
      ).rejects.toThrow();

      const refund = await pool.query(
        `SELECT status FROM refunds WHERE "paymentId" = $1`,
        [fixture.paymentId],
      );

      expect(refund.rows).toHaveLength(1);
      expect(refund.rows[0].status).toBe("SUBMISSION_UNKNOWN");

      const reconciliation = await pool.query(
        `SELECT status FROM payment_inventory_reconciliations
       WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("REFUND_PENDING");

      const payment = await pool.query(
        `SELECT "reconciliationRequired" FROM payments
       WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("marks the refund SUBMISSION_UNKNOWN when Paystack returns an incorrect currency", async () => {
    const fixture = await createFixture();

    try {
      paystackMocks.createRefund.mockResolvedValue({
        ...successfulPaystackRefund(),
        currency: "USD", // Expected: NGN
      });

      await expect(
        resolveReconciliationAsRefunded(
          fixture.reconciliationId,
          fixture.userId,
          "Refund after inventory failure",
        ),
      ).rejects.toThrow();

      const refund = await pool.query(
        `SELECT status FROM refunds WHERE "paymentId" = $1`,
        [fixture.paymentId],
      );

      expect(refund.rows).toHaveLength(1);
      expect(refund.rows[0].status).toBe("SUBMISSION_UNKNOWN");

      const reconciliation = await pool.query(
        `SELECT status FROM payment_inventory_reconciliations
       WHERE id = $1`,
        [fixture.reconciliationId],
      );

      expect(reconciliation.rows[0].status).toBe("REFUND_PENDING");

      const payment = await pool.query(
        `SELECT "reconciliationRequired" FROM payments
       WHERE id = $1`,
        [fixture.paymentId],
      );

      expect(payment.rows[0].reconciliationRequired).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
