import { AppError } from "../src/common/errors/AppError";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  cancelOrder: vi.fn(),
  adminCancelOrder: vi.fn(),
  findStaffAccount: vi.fn(),
}));

vi.mock("../src/modules/orders/order.service", () => ({
  cancelOrder: mocks.cancelOrder,
  adminCancelOrder: mocks.adminCancelOrder,
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaffAccount },
  },
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const orderId = "2eb258a2-8574-46c9-a4d1-e86b8c8fe23e";

function makeToken(
  subject: string,
  permissions: string[] = ["orders.create"],
  identityType: "CUSTOMER" | "STAFF" = "CUSTOMER",
) {
  return jwt.sign(
    { identityType, roles: [], permissions },
    JWT_ACCESS_SECRET,
    { subject, expiresIn: "5m" },
  );
}

const customerToken = makeToken("test-customer");
const adminToken = makeToken("test-admin", ["orders.manage"], "STAFF");
const unauthorizedAdminToken = makeToken(
  "test-admin-without-permission",
  ["orders.create"],
  "STAFF",
);

const customerCancelUrl = `/api/v1/orders/${orderId}/cancel`;
const adminCancelUrl = `/api/v1/orders/${orderId}/admin-cancel`;

const successfulCancellation = {
  status: "CANCELLED",
  alreadyCancelled: false,
};

describe("order cancellation HTTP endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.cancelOrder.mockResolvedValue(successfulCancellation);
    mocks.adminCancelOrder.mockResolvedValue(successfulCancellation);
    mocks.findStaffAccount.mockImplementation(async ({ where }) => ({
      status: "ACTIVE",
      roles:
        where.id === "test-admin"
          ? [
              {
                role: {
                  name: "ADMIN",
                  permissions: [
                    { permission: { name: "orders.manage" } },
                  ],
                },
              },
            ]
          : [],
    }));
  });

  it("rejects unauthenticated customer cancellation requests", async () => {
    const response = await request(app).patch(customerCancelUrl);

    expect(response.status).toBe(401);
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it("allows an authenticated customer to cancel their order", async () => {
    const response = await request(app)
      .patch(customerCancelUrl)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Order cancelled successfully");

    expect(mocks.cancelOrder).toHaveBeenCalledWith(
      orderId,
      "test-customer",
      expect.any(Object),
    );

    expect(mocks.adminCancelOrder).not.toHaveBeenCalled();
  });

  it("rejects cancellation when the order belongs to another customer", async () => {
    mocks.cancelOrder.mockRejectedValueOnce(
       new AppError("You are not allowed to cancel this order", 403),
    );

    const response = await request(app)
      .patch(customerCancelUrl)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated admin cancellation requests", async () => {
    const response = await request(app).patch(adminCancelUrl);

    expect(response.status).toBe(401);
    expect(mocks.adminCancelOrder).not.toHaveBeenCalled();
  });

  it("rejects customers attempting to access the admin cancellation endpoint", async () => {
    const response = await request(app)
      .patch(adminCancelUrl)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
    expect(mocks.adminCancelOrder).not.toHaveBeenCalled();
  });

  it("rejects admins without orders.manage permission", async () => {
    const response = await request(app)
      .patch(adminCancelUrl)
      .set("Authorization", `Bearer ${unauthorizedAdminToken}`);

    expect(response.status).toBe(403);
    expect(mocks.adminCancelOrder).not.toHaveBeenCalled();
  });

  it("allows an admin with orders.manage to cancel an order", async () => {
    const response = await request(app)
      .patch(adminCancelUrl)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Order cancelled successfully by admin",
    );

    expect(mocks.adminCancelOrder).toHaveBeenCalledWith(
      orderId,
      "test-admin",
      expect.any(Object),
    );

    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it("rejects invalid order IDs", async () => {
    const response = await request(app)
      .patch("/api/v1/orders/invalid-order-id/cancel")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });
});
