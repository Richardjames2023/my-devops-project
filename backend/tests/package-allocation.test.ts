import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  allocatePackage: vi.fn(),
}));

vi.mock("../src/modules/fulfillment/fulfillment.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/fulfillment/fulfillment.service")>();
  return { ...actual, allocatePackage: mocks.allocatePackage };
});

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

function makeToken(permissions: string[] = ["orders.manage"]) {
  return jwt.sign(
    { roles: [], permissions },
    JWT_ACCESS_SECRET,
    { subject: "warehouse-user", expiresIn: "5m" },
  );
}

const fulfillmentId = "a4e7e6d2-2b5f-4c55-9b30-3c9c4f3b2a11";
const orderItemId = "b4e7e6d2-2b5f-4c55-9b30-3c9c4f3b2a22";

describe("package allocation HTTP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.allocatePackage.mockResolvedValue({
      id: "c4e7e6d2-2b5f-4c55-9b30-3c9c4f3b2a33",
      fulfillmentId,
      status: "PENDING",
      items: [{ orderItemId, quantity: 2 }],
    });
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .post(`/api/v1/fulfillments/${fulfillmentId}/packages`)
      .send({ items: [{ orderItemId, quantity: 2 }] });

    expect(response.status).toBe(401);
    expect(mocks.allocatePackage).not.toHaveBeenCalled();
  });

  it("requires orders.manage permission", async () => {
    const response = await request(app)
      .post(`/api/v1/fulfillments/${fulfillmentId}/packages`)
      .set("Authorization", `Bearer ${makeToken([])}`)
      .send({ items: [{ orderItemId, quantity: 2 }] });

    expect(response.status).toBe(403);
    expect(mocks.allocatePackage).not.toHaveBeenCalled();
  });

  it("creates a package from valid order-item quantities", async () => {
    const response = await request(app)
      .post(`/api/v1/fulfillments/${fulfillmentId}/packages`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        items: [{ orderItemId, quantity: 2 }],
        weight: 1.25,
        dimensions: { length: 20, width: 15, height: 10 },
      });

    expect(response.status).toBe(201);
    expect(response.body.package.items).toEqual([{ orderItemId, quantity: 2 }]);
    expect(mocks.allocatePackage).toHaveBeenCalledWith(fulfillmentId, {
      items: [{ orderItemId, quantity: 2 }],
      weight: 1.25,
      dimensions: { length: 20, width: 15, height: 10 },
    });
  });

  it("rejects duplicate order items in one package", async () => {
    const response = await request(app)
      .post(`/api/v1/fulfillments/${fulfillmentId}/packages`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        items: [
          { orderItemId, quantity: 1 },
          { orderItemId, quantity: 1 },
        ],
      });

    expect(response.status).toBe(400);
    expect(mocks.allocatePackage).not.toHaveBeenCalled();
  });

  it("rejects invalid IDs and non-positive quantities", async () => {
    const response = await request(app)
      .post("/api/v1/fulfillments/not-a-uuid/packages")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ items: [{ orderItemId, quantity: 0 }] });

    expect(response.status).toBe(400);
    expect(mocks.allocatePackage).not.toHaveBeenCalled();
  });
});
