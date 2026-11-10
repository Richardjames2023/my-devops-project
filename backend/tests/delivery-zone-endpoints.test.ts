import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  createDeliveryZone: vi.fn(),
  listActiveDeliveryZones: vi.fn(),
  quoteDeliveryFee: vi.fn(),
  listDeliveryZones: vi.fn(),
  updateDeliveryZone: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: { staffAccount: { findUnique: mocks.findStaff } },
}));

vi.mock("../src/modules/delivery-zones/delivery-zone.service", () => ({
  createDeliveryZone: mocks.createDeliveryZone,
  listActiveDeliveryZones: mocks.listActiveDeliveryZones,
  quoteDeliveryFee: mocks.quoteDeliveryFee,
  listDeliveryZones: mocks.listDeliveryZones,
  updateDeliveryZone: mocks.updateDeliveryZone,
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const zoneId = "8d6c5b4a-3f2e-4d1c-9b8a-7e6f5d4c3b2a";

function makeToken(identityType: "STAFF" | "CUSTOMER" = "STAFF") {
  return jwt.sign(
    { identityType, roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

function staffRecord(permissionNames: string[]) {
  return {
    status: "ACTIVE",
    roles: [{
      role: {
        name: "BUSINESS_OWNER",
        permissions: permissionNames.map((name) => ({
          permission: { name },
        })),
      },
    }],
  };
}

describe("delivery-zone HTTP endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listActiveDeliveryZones.mockResolvedValue([]);
    mocks.listDeliveryZones.mockResolvedValue([]);
    mocks.quoteDeliveryFee.mockResolvedValue({
      zoneId,
      zoneName: "Abuja Metro",
      deliveryFee: "1500",
      currency: "NGN",
    });
  });

  it("serves active zones publicly", async () => {
    mocks.listActiveDeliveryZones.mockResolvedValue([
      { id: zoneId, name: "Abuja Metro", deliveryFee: "1500", locations: [] },
    ]);

    const response = await request(app).get("/api/v1/delivery-zones");

    expect(response.status).toBe(200);
    expect(response.body.deliveryZones).toHaveLength(1);
    expect(mocks.listActiveDeliveryZones).toHaveBeenCalledOnce();
  });

  it("validates and returns a public delivery quote", async () => {
    const response = await request(app)
      .get("/api/v1/delivery-zones/quote")
      .query({ state: "Abuja FCT", city: "Wuse" });

    expect(response.status).toBe(200);
    expect(response.body.quote).toMatchObject({
      zoneId,
      zoneName: "Abuja Metro",
      currency: "NGN",
    });
    expect(mocks.quoteDeliveryFee).toHaveBeenCalledWith("Abuja FCT", "Wuse");
  });

  it("rejects an invalid public quote query before calling the service", async () => {
    const response = await request(app)
      .get("/api/v1/delivery-zones/quote")
      .query({ state: "", city: "Wuse" });

    expect(response.status).toBe(400);
    expect(mocks.quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it("creates a zone for an authorized Business Owner", async () => {
    mocks.findStaff.mockResolvedValue(staffRecord(["delivery_zones.manage"]));
    mocks.createDeliveryZone.mockResolvedValue({
      id: zoneId,
      name: "Abuja Metro",
      deliveryFee: "1500",
    });

    const response = await request(app)
      .post("/api/v1/staff/delivery-zones")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "Abuja Metro",
        deliveryFee: 1500,
        locations: [{ state: "Abuja FCT", city: "Wuse" }],
      });

    expect(response.status).toBe(201);
    expect(response.body.deliveryZone).toMatchObject({
      id: zoneId,
      name: "Abuja Metro",
    });
    expect(mocks.createDeliveryZone).toHaveBeenCalledWith(
      staffId,
      {
        name: "Abuja Metro",
        deliveryFee: 1500,
        locations: [{ state: "ABUJA FCT", city: "WUSE" }],
      },
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });

  it("rejects invalid create payloads before calling the service", async () => {
    mocks.findStaff.mockResolvedValue(staffRecord(["delivery_zones.manage"]));

    const response = await request(app)
      .post("/api/v1/staff/delivery-zones")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ name: "A", deliveryFee: -1, locations: [] });

    expect(response.status).toBe(400);
    expect(mocks.createDeliveryZone).not.toHaveBeenCalled();
  });

  it("updates a zone for an authorized Business Owner", async () => {
    mocks.findStaff.mockResolvedValue(staffRecord(["delivery_zones.manage"]));
    mocks.updateDeliveryZone.mockResolvedValue({
      id: zoneId,
      name: "Abuja Metro",
      deliveryFee: "1800",
      isActive: true,
    });

    const response = await request(app)
      .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ deliveryFee: 1800 });

    expect(response.status).toBe(200);
    expect(response.body.deliveryZone).toMatchObject({
      id: zoneId,
      deliveryFee: "1800",
    });
    expect(mocks.updateDeliveryZone).toHaveBeenCalledWith(
      staffId,
      zoneId,
      { deliveryFee: 1800 },
      expect.any(Object),
    );
  });

  it("rejects empty updates and invalid zone IDs", async () => {
    mocks.findStaff.mockResolvedValue(staffRecord(["delivery_zones.manage"]));

    const emptyUpdate = await request(app)
      .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({});
    const invalidId = await request(app)
      .patch("/api/v1/staff/delivery-zones/not-a-uuid")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ isActive: false });

    expect(emptyUpdate.status).toBe(400);
    expect(invalidId.status).toBe(400);
    expect(mocks.updateDeliveryZone).not.toHaveBeenCalled();
  });

  it("does not allow a Delivery Agent to create or update zones", async () => {
    mocks.findStaff.mockResolvedValue(staffRecord(["deliveries.manage"]));

    const createResponse = await request(app)
      .post("/api/v1/staff/delivery-zones")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        name: "Restricted Zone",
        deliveryFee: 500,
        locations: [{ state: "Gombe", city: "Gombe" }],
      });
    const updateResponse = await request(app)
      .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ isActive: false });

    expect(createResponse.status).toBe(403);
    expect(updateResponse.status).toBe(403);
    expect(mocks.createDeliveryZone).not.toHaveBeenCalled();
    expect(mocks.updateDeliveryZone).not.toHaveBeenCalled();
  });
});
