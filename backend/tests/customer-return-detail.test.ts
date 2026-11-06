import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  getCustomerReturnRequest: vi.fn(),
}));

vi.mock("../src/modules/return/return.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/return/return.service")>();
  return {
    ...actual,
    getCustomerReturnRequest: mocks.getCustomerReturnRequest,
  };
});

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";
import { AppError } from "../src/common/errors/AppError";

function makeToken(subject: string) {
  return jwt.sign(
    { roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject, expiresIn: "5m" },
  );
}

const customerToken = makeToken("customer-one");
const returnRequestId = "a4e7e6d2-2b5f-4c55-9b30-3c9c4f3b2a11";

describe("customer return detail HTTP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCustomerReturnRequest.mockResolvedValue({
      id: returnRequestId,
      status: "INSPECTED",
      items: [],
      evidence: [],
    });
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/returns/${returnRequestId}`);

    expect(response.status).toBe(401);
    expect(mocks.getCustomerReturnRequest).not.toHaveBeenCalled();
  });

  it("returns the requested return belonging to the authenticated customer", async () => {
    const response = await request(app)
      .get(`/api/v1/returns/${returnRequestId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.returnRequest).toEqual({
      id: returnRequestId,
      status: "INSPECTED",
      items: [],
      evidence: [],
    });
    expect(mocks.getCustomerReturnRequest).toHaveBeenCalledWith(
      "customer-one",
      returnRequestId,
    );
  });

  it("rejects an invalid return request ID", async () => {
    const response = await request(app)
      .get("/api/v1/returns/not-a-uuid")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(400);
    expect(mocks.getCustomerReturnRequest).not.toHaveBeenCalled();
  });

  it("does not allow a customer ID to be supplied in the query string", async () => {
    await request(app)
      .get(`/api/v1/returns/${returnRequestId}?userId=another-customer`)
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(200);

    expect(mocks.getCustomerReturnRequest).toHaveBeenCalledWith(
      "customer-one",
      returnRequestId,
    );
  });

  it("returns not found when the request is not owned by the customer", async () => {
    mocks.getCustomerReturnRequest.mockRejectedValue(
      new AppError("Return request not found", 404),
    );

    const response = await request(app)
      .get(`/api/v1/returns/${returnRequestId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(404);
  });
});
