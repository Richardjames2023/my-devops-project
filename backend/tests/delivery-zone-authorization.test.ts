import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  listDeliveryZones: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaff },
  },
}));

vi.mock("../src/modules/delivery-zones/delivery-zone.service", () => ({
  createDeliveryZone: vi.fn(),
  listActiveDeliveryZones: vi.fn(),
  listDeliveryZones: mocks.listDeliveryZones,
  quoteDeliveryFee: vi.fn(),
  updateDeliveryZone: vi.fn(),
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";

function makeToken(identityType: "STAFF" | "CUSTOMER") {
  return jwt.sign(
    { identityType, roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

function staffRecord(roleName: string, permissionNames: string[]) {
  return {
    status: "ACTIVE",
    roles: [{
      role: {
        name: roleName,
        permissions: permissionNames.map((name) => ({
          permission: { name },
        })),
      },
    }],
  };
}

describe("delivery-zone management authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listDeliveryZones.mockResolvedValue([]);
  });

  it("allows a Business Owner with delivery_zones.manage", async () => {
    mocks.findStaff.mockResolvedValue(
      staffRecord("BUSINESS_OWNER", ["delivery_zones.manage"]),
    );

    const response = await request(app)
      .get("/api/v1/staff/delivery-zones")
      .set("Authorization", "Bearer " + makeToken("STAFF"));

    expect(response.status).toBe(200);
    expect(response.body.deliveryZones).toEqual([]);
    expect(mocks.listDeliveryZones).toHaveBeenCalledOnce();
  });

  it("denies a Delivery Agent who only has deliveries.manage", async () => {
    mocks.findStaff.mockResolvedValue(
      staffRecord("DELIVERY_AGENT", ["deliveries.manage"]),
    );

    const response = await request(app)
      .get("/api/v1/staff/delivery-zones")
      .set("Authorization", "Bearer " + makeToken("STAFF"));

    expect(response.status).toBe(403);
    expect(mocks.listDeliveryZones).not.toHaveBeenCalled();
  });

  it("denies staff without the dedicated delivery-zone permission", async () => {
    mocks.findStaff.mockResolvedValue(
      staffRecord("ORDER_OPERATOR", ["orders.manage", "deliveries.manage"]),
    );

    const response = await request(app)
      .get("/api/v1/staff/delivery-zones")
      .set("Authorization", "Bearer " + makeToken("STAFF"));

    expect(response.status).toBe(403);
    expect(mocks.listDeliveryZones).not.toHaveBeenCalled();
  });

  it("denies customer identities", async () => {
    const response = await request(app)
      .get("/api/v1/staff/delivery-zones")
      .set("Authorization", "Bearer " + makeToken("CUSTOMER"));

    expect(response.status).toBe(403);
    expect(mocks.findStaff).not.toHaveBeenCalled();
    expect(mocks.listDeliveryZones).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/staff/delivery-zones");

    expect(response.status).toBe(401);
    expect(mocks.findStaff).not.toHaveBeenCalled();
    expect(mocks.listDeliveryZones).not.toHaveBeenCalled();
  });
});
