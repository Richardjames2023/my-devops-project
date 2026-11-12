import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  adjustStock: vi.fn(),
  createStockMovement: vi.fn(),
  findStaffAccount: vi.fn(),
}));

vi.mock("../src/modules/inventory/stock-movement.service", () => ({
  adjustStock: mocks.adjustStock,
  createStockMovement: mocks.createStockMovement,
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: { staffAccount: { findUnique: mocks.findStaffAccount } },
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "b2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";
const inventoryId = "d2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";

function token(identityType: "STAFF" | "CUSTOMER" = "STAFF") {
  return jwt.sign(
    { identityType, roles: [], permissions: ["inventory.manage"] },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

describe("audited stock adjustment HTTP endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findStaffAccount.mockResolvedValue({
      status: "ACTIVE",
      roles: [{
        role: {
          name: "INVENTORY_MANAGER",
          permissions: [{ permission: { name: "inventory.manage" } }],
        },
      }],
    });
    mocks.adjustStock.mockResolvedValue({
      inventory: { id: inventoryId, quantity: 12 },
      movement: { id: "movement-id", type: "ADJUSTMENT", quantity: 2 },
    });
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/movements/adjustments")
      .send({ inventoryId, direction: "INCREASE", quantity: 2, reason: "Stock count" });

    expect(response.status).toBe(401);
    expect(mocks.adjustStock).not.toHaveBeenCalled();
  });

  it("rejects customer identities even when their token contains the permission", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/movements/adjustments")
      .set("Authorization", `Bearer ${token("CUSTOMER")}`)
      .send({ inventoryId, direction: "INCREASE", quantity: 2, reason: "Stock count" });

    expect(response.status).toBe(403);
    expect(mocks.adjustStock).not.toHaveBeenCalled();
  });

  it("requires the current inventory.manage staff permission", async () => {
    mocks.findStaffAccount.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { name: "SUPPORT_STAFF", permissions: [] } }],
    });

    const response = await request(app)
      .post("/api/v1/inventory/movements/adjustments")
      .set("Authorization", `Bearer ${token()}`)
      .send({ inventoryId, direction: "INCREASE", quantity: 2, reason: "Stock count" });

    expect(response.status).toBe(403);
    expect(mocks.adjustStock).not.toHaveBeenCalled();
  });

  it("validates the required reason and quantity", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/movements/adjustments")
      .set("Authorization", `Bearer ${token()}`)
      .send({ inventoryId, direction: "DECREASE", quantity: 0 });

    expect(response.status).toBe(400);
    expect(mocks.adjustStock).not.toHaveBeenCalled();
  });

  it("passes the authenticated staff actor and audit metadata to the service", async () => {
    const response = await request(app)
      .post("/api/v1/inventory/movements/adjustments")
      .set("Authorization", `Bearer ${token()}`)
      .set("User-Agent", "stock-adjustment-http-test")
      .send({
        inventoryId,
        direction: "INCREASE",
        quantity: 2,
        reason: "Physical count correction",
        reference: "COUNT-002",
      });

    expect(response.status).toBe(200);
    expect(response.body.inventory.quantity).toBe(12);
    expect(mocks.adjustStock).toHaveBeenCalledWith(
      {
        inventoryId,
        direction: "INCREASE",
        quantity: 2,
        reason: "Physical count correction",
        reference: "COUNT-002",
      },
      staffId,
      expect.objectContaining({
        userAgent: "stock-adjustment-http-test",
      }),
    );
  });
});
