
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findEvent: vi.fn(),
  updateEvent: vi.fn(),
  findPayment: vi.fn(),
  findRefunds: vi.fn(),
  reconcileRefund: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    processedWebhookEvent: {
      findUnique: mocks.findEvent,
      updateMany: mocks.updateEvent,
    },
    payment: {
      findUnique: mocks.findPayment,
    },
    refund: {
      findMany: mocks.findRefunds,
    },
  },
}));

vi.mock("../src/modules/refund/refund.service", () => ({
  processPaystackRefundWebhook: vi.fn(),
  reconcileRefund: mocks.reconcileRefund,
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const eventId = "2eb258a2-8574-46c9-a4d1-e86b8c8fe23e";

const fakeEvent = {
  id: eventId,
  eventKey: "manual-recovery-test-001",
  eventType: "refund.processing",
  status: "PROCESSING",
  processingStartedAt: new Date(Date.now() - 15 * 60 * 1000),
  recoveryStartedAt: null,
  recoveryToken: null,
  transactionReference: "TEST-TRANSACTION-NOT-REAL",
  refundReference: null,
  amount: "10000",
  currency: "NGN",
  providerStatus: "processing",
  lastError: null,
};

function makeToken(permissions: string[] = ["orders.manage"]) {
  return jwt.sign(
    { roles: [], permissions },
    JWT_ACCESS_SECRET,
    { subject: "test-admin", expiresIn: "5m" },
  );
}

const recoveryUrl = `/api/v1/payments/webhooks/${eventId}/reconcile`;

describe("stale webhook recovery endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findEvent.mockResolvedValue({ ...fakeEvent });
    mocks.findPayment.mockResolvedValue(null);

    // Simulate an atomic database claim and its subsequent release.
    mocks.updateEvent.mockResolvedValue({ count: 1 });
    mocks.findRefunds.mockResolvedValue([]);
  });

  it("rejects unauthenticated recovery requests", async () => {
    const response = await request(app).post(recoveryUrl);

    expect(response.status).toBe(401);
    expect(mocks.findEvent).not.toHaveBeenCalled();
  });

  it("rejects users without orders.manage", async () => {
    const response = await request(app)
      .post(recoveryUrl)
      .set("Authorization", `Bearer ${makeToken(["orders.create"])}`);

    expect(response.status).toBe(403);
    expect(mocks.findEvent).not.toHaveBeenCalled();
  });

  it("releases the claim when the associated payment is missing", async () => {
    const response = await request(app)
      .post(recoveryUrl)
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe(
      "Failed to reconcile stale webhook event; inspect the event and refund state",
    );

    expect(mocks.updateEvent).toHaveBeenCalledTimes(2);

    expect(mocks.updateEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: eventId,
          status: "PROCESSING",
          recoveryToken: null,
        }),
        data: expect.objectContaining({
          status: "RECOVERING",
        }),
      }),
    );

    expect(mocks.updateEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: eventId,
          status: "RECOVERING",
          recoveryToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "PROCESSING",
          recoveryToken: null,
          recoveryStartedAt: null,
          lastError:
            "Associated payment was not found; manual review is required",
        }),
      }),
    );

    expect(mocks.findPayment).toHaveBeenCalledTimes(1);
    expect(mocks.findRefunds).not.toHaveBeenCalled();
    expect(mocks.reconcileRefund).not.toHaveBeenCalled();
  });

  it("allows only one concurrent request to claim the event", async () => {
    let claimAttempts = 0;

    mocks.updateEvent.mockImplementation(async ({ data }) => {
      if (data.status === "RECOVERING") {
        claimAttempts += 1;
        return { count: claimAttempts === 1 ? 1 : 0 };
      }

      // The winning request releases its claim after finding no payment.
      return { count: 1 };
    });

    const token = makeToken();

    const responses = await Promise.all([
      request(app)
        .post(recoveryUrl)
        .set("Authorization", `Bearer ${token}`),
      request(app)
        .post(recoveryUrl)
        .set("Authorization", `Bearer ${token}`),
    ]);

    expect(claimAttempts).toBe(2);

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([409, 500]);

    expect(mocks.findPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileRefund).not.toHaveBeenCalled();
  });


  it("releases the claim when refund reconciliation is inconclusive", async () => {
    mocks.findPayment.mockResolvedValue({ id: "test-payment-id" });
    mocks.findRefunds.mockResolvedValue([
      {
        id: "test-refund-id",
        reference: "TEST-REFUND",
        providerReference: "TEST-PROVIDER-REFUND",
      },
    ]);
    mocks.reconcileRefund.mockResolvedValue({
      id: "test-refund-id",
      status: "PROCESSING",
    });

    const response = await request(app)
      .post(recoveryUrl)
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "Refund reconciliation is not yet conclusive",
    );

    expect(mocks.updateEvent).toHaveBeenCalledTimes(2);
    expect(mocks.updateEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RECOVERING",
          recoveryToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "PROCESSING",
          recoveryToken: null,
          recoveryStartedAt: null,
          lastError: "Refund reconciliation remains inconclusive.",
        }),
      }),
    );
  });

  it("marks the event PROCESSED after confirmed terminal reconciliation", async () => {
    mocks.findPayment.mockResolvedValue({ id: "test-payment-id" });
    mocks.findRefunds.mockResolvedValue([
      {
        id: "test-refund-id",
        reference: "TEST-REFUND",
        providerReference: "TEST-PROVIDER-REFUND",
      },
    ]);
    mocks.reconcileRefund.mockResolvedValue({
      id: "test-refund-id",
      status: "SUCCESS",
    });

    const response = await request(app)
      .post(recoveryUrl)
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Stale webhook event reconciled successfully",
    );

    expect(mocks.updateEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RECOVERING",
          recoveryToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "PROCESSED",
          recoveryToken: null,
          recoveryStartedAt: null,
          lastError: null,
        }),
      }),
    );
  });

  it("does not complete the event if recovery ownership changes", async () => {
    mocks.findPayment.mockResolvedValue({ id: "test-payment-id" });
    mocks.findRefunds.mockResolvedValue([
      {
        id: "test-refund-id",
        reference: "TEST-REFUND",
        providerReference: "TEST-PROVIDER-REFUND",
      },
    ]);
    mocks.reconcileRefund.mockResolvedValue({
      id: "test-refund-id",
      status: "SUCCESS",
    });

    mocks.updateEvent
      .mockResolvedValueOnce({ count: 1 }) // Claim succeeds.
      .mockResolvedValueOnce({ count: 0 }) // Completion loses ownership.
      .mockResolvedValueOnce({ count: 0 }); // Conditional release cannot overwrite another owner.

    const response = await request(app)
      .post(recoveryUrl)
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe(
      "Failed to reconcile stale webhook event; inspect the event and refund state",
    );

    expect(mocks.updateEvent).toHaveBeenCalledTimes(3);
    expect(mocks.updateEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RECOVERING",
          recoveryToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "PROCESSED",
        }),
      }),
    );
  });

});
