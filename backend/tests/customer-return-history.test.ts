import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  listCustomerReturnRequests: vi.fn(),
}));

vi.mock("../src/modules/return/return.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/return/return.service")>();
  return {
    ...actual,
    listCustomerReturnRequests: mocks.listCustomerReturnRequests,
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

describe("customer return history HTTP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listCustomerReturnRequests.mockResolvedValue({
      returnRequests: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/returns");

    expect(response.status).toBe(401);
    expect(mocks.listCustomerReturnRequests).not.toHaveBeenCalled();
  });

  it("returns the authenticated customer's return history", async () => {
    const response = await request(app)
      .get("/api/v1/returns")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.returnRequests).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
    expect(mocks.listCustomerReturnRequests).toHaveBeenCalledWith(
      "customer-one",
      { page: 1, limit: 10 },
    );
  });

  it("supports pagination and return status filters", async () => {
    await request(app)
      .get("/api/v1/returns?page=2&limit=20&status=INSPECTED")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);

    expect(mocks.listCustomerReturnRequests).toHaveBeenCalledWith(
      "customer-one",
      { page: 2, limit: 20, status: "INSPECTED" },
    );
  });

  it("rejects invalid pagination and return statuses", async () => {
    const response = await request(app)
      .get("/api/v1/returns?page=0&limit=100&status=UNKNOWN")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
    expect(mocks.listCustomerReturnRequests).not.toHaveBeenCalled();
  });

  it("does not accept a customer ID from the query string", async () => {
    await request(app)
      .get("/api/v1/returns?userId=another-customer")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);

    expect(mocks.listCustomerReturnRequests).toHaveBeenCalledWith(
      "customer-one",
      { page: 1, limit: 10 },
    );
  });
});
