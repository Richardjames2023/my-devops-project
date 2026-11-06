import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  listCustomerOrders: vi.fn(),
}));

vi.mock("../src/modules/orders/order.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/orders/order.service")>();
  return {
    ...actual,
    listCustomerOrders: mocks.listCustomerOrders,
  };
});

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

function makeToken(subject: string) {
  return jwt.sign(
    { roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject, expiresIn: "5m" },
  );
}

const customerToken = makeToken("customer-one");

describe("customer order history HTTP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listCustomerOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/orders");

    expect(response.status).toBe(401);
    expect(mocks.listCustomerOrders).not.toHaveBeenCalled();
  });

  it("returns only the authenticated customer's order history", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.orders).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
    expect(mocks.listCustomerOrders).toHaveBeenCalledWith("customer-one", {
      page: 1,
      limit: 10,
    });
  });

  it("supports pagination and status filters", async () => {
    await request(app)
      .get("/api/v1/orders?page=2&limit=20&status=FULFILLED")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);

    expect(mocks.listCustomerOrders).toHaveBeenCalledWith("customer-one", {
      page: 2,
      limit: 20,
      status: "FULFILLED",
    });
  });

  it("rejects invalid pagination and order statuses", async () => {
    const response = await request(app)
      .get("/api/v1/orders?page=0&limit=100&status=UNKNOWN")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
    expect(mocks.listCustomerOrders).not.toHaveBeenCalled();
  });

  it("does not accept a customer ID from the query string", async () => {
    await request(app)
      .get("/api/v1/orders?userId=another-customer")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);

    expect(mocks.listCustomerOrders).toHaveBeenCalledWith("customer-one", {
      page: 1,
      limit: 10,
    });
  });
});
