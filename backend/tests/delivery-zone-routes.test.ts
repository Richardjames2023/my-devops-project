import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { AppError } from "../src/common/errors/AppError";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  createDeliveryZone: vi.fn(),
  listActiveDeliveryZones: vi.fn(),
  listDeliveryZones: vi.fn(),
  quoteDeliveryFee: vi.fn(),
  updateDeliveryZone: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaff },
  },
}));

vi.mock("../src/modules/delivery-zones/delivery-zone.service", () => ({
  createDeliveryZone: mocks.createDeliveryZone,
  listActiveDeliveryZones: mocks.listActiveDeliveryZones,
  listDeliveryZones: mocks.listDeliveryZones,
  quoteDeliveryFee: mocks.quoteDeliveryFee,
  updateDeliveryZone: mocks.updateDeliveryZone,
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const zoneId = "a4b5c6d7-e8f9-4012-8abc-1234567890ab";

const validCreateInput = {
  name: "Abuja Metro",
  deliveryFee: 350.5,
  locations: [
    { state: "FCT", city: "Wuse" },
    { state: "FCT", city: "Garki" },
  ],
};

function makeToken(identityType: "STAFF" | "CUSTOMER" = "STAFF") {
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

function authorizeBusinessOwner() {
  mocks.findStaff.mockResolvedValue(
    staffRecord("BUSINESS_OWNER", ["delivery_zones.manage"]),
  );
}

describe("delivery-zone HTTP routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authorizeBusinessOwner();
  });

  describe("staff create route", () => {
    it("creates a delivery zone for an authorized staff member", async () => {
      const createdZone = {
        id: zoneId,
        name: "Abuja Metro",
        deliveryFee: "350.50",
        isActive: true,
        locations: [
          { state: "FCT", city: "WUSE" },
          { state: "FCT", city: "GARKI" },
        ],
      };
      mocks.createDeliveryZone.mockResolvedValue(createdZone);

      const response = await request(app)
        .post("/api/v1/staff/delivery-zones")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("User-Agent", "delivery-zone-route-test")
        .send(validCreateInput);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        message: "Delivery zone created successfully",
        deliveryZone: createdZone,
      });
      expect(mocks.createDeliveryZone).toHaveBeenCalledWith(
        staffId,
        {
          name: "Abuja Metro",
          deliveryFee: 350.5,
          locations: [
            { state: "FCT", city: "WUSE" },
            { state: "FCT", city: "GARKI" },
          ],
        },
        expect.objectContaining({ userAgent: "delivery-zone-route-test" }),
      );
    });

    it("rejects an invalid payload before calling the service", async () => {
      const response = await request(app)
        .post("/api/v1/staff/delivery-zones")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ ...validCreateInput, deliveryFee: 350.005 });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(mocks.createDeliveryZone).not.toHaveBeenCalled();
    });

    it("rejects duplicate locations after normalization", async () => {
      const response = await request(app)
        .post("/api/v1/staff/delivery-zones")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({
          ...validCreateInput,
          locations: [
            { state: "FCT", city: "Wuse" },
            { state: " fct ", city: " WUSE " },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(mocks.createDeliveryZone).not.toHaveBeenCalled();
    });

    it("denies staff without delivery_zones.manage", async () => {
      mocks.findStaff.mockResolvedValue(
        staffRecord("DELIVERY_AGENT", ["deliveries.manage"]),
      );

      const response = await request(app)
        .post("/api/v1/staff/delivery-zones")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send(validCreateInput);

      expect(response.status).toBe(403);
      expect(mocks.createDeliveryZone).not.toHaveBeenCalled();
    });
  });

  describe("staff update route", () => {
    it("updates a delivery zone for an authorized staff member", async () => {
      const updatedZone = {
        id: zoneId,
        name: "Abuja Central",
        deliveryFee: "450.00",
        isActive: true,
        locations: [{ state: "FCT", city: "WUSE" }],
      };
      mocks.updateDeliveryZone.mockResolvedValue(updatedZone);

      const response = await request(app)
        .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "Abuja Central", deliveryFee: 450 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: "Delivery zone updated successfully",
        deliveryZone: updatedZone,
      });
      expect(mocks.updateDeliveryZone).toHaveBeenCalledWith(
        staffId,
        zoneId,
        { name: "Abuja Central", deliveryFee: 450 },
        expect.any(Object),
      );
    });

    it("rejects a malformed zone ID", async () => {
      const response = await request(app)
        .patch("/api/v1/staff/delivery-zones/not-a-uuid")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ deliveryFee: 450 });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(mocks.updateDeliveryZone).not.toHaveBeenCalled();
    });

    it("rejects an empty update payload", async () => {
      const response = await request(app)
        .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(mocks.updateDeliveryZone).not.toHaveBeenCalled();
    });

    it("returns 404 when the zone does not exist", async () => {
      mocks.updateDeliveryZone.mockRejectedValue(
        new AppError("Delivery zone not found", 404),
      );

      const response = await request(app)
        .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ deliveryFee: 450 });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Delivery zone not found");
    });

    it("returns 409 when an update conflicts with an existing location or name", async () => {
      mocks.updateDeliveryZone.mockRejectedValue(
        new AppError(
          "A delivery zone with this name or one of these locations already exists",
          409,
        ),
      );

      const response = await request(app)
        .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ locations: [{ state: "FCT", city: "Wuse" }] });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain("already exists");
    });

    it("denies staff without delivery_zones.manage", async () => {
      mocks.findStaff.mockResolvedValue(
        staffRecord("DELIVERY_AGENT", ["deliveries.manage"]),
      );

      const response = await request(app)
        .patch(`/api/v1/staff/delivery-zones/${zoneId}`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ deliveryFee: 450 });

      expect(response.status).toBe(403);
      expect(mocks.updateDeliveryZone).not.toHaveBeenCalled();
    });
  });

  describe("public delivery-zone routes", () => {
    it("lists active delivery zones without authentication", async () => {
      const activeZones = [{
        id: zoneId,
        name: "Abuja Metro",
        deliveryFee: "350.00",
        locations: [{ state: "FCT", city: "WUSE" }],
      }];
      mocks.listActiveDeliveryZones.mockResolvedValue(activeZones);

      const response = await request(app).get("/api/v1/delivery-zones");

      expect(response.status).toBe(200);
      expect(response.body.deliveryZones).toEqual(activeZones);
      expect(mocks.listActiveDeliveryZones).toHaveBeenCalledOnce();
      expect(mocks.findStaff).not.toHaveBeenCalled();
    });

    it("returns a delivery quote for a served destination", async () => {
      const quote = {
        zoneId,
        zoneName: "Abuja Metro",
        deliveryFee: "350.00",
        currency: "NGN",
      };
      mocks.quoteDeliveryFee.mockResolvedValue(quote);

      const response = await request(app)
        .get("/api/v1/delivery-zones/quote")
        .query({ state: "FCT", city: "Wuse" });

      expect(response.status).toBe(200);
      expect(response.body.quote).toEqual(quote);
      expect(mocks.quoteDeliveryFee).toHaveBeenCalledWith("FCT", "Wuse");
      expect(mocks.findStaff).not.toHaveBeenCalled();
    });

    it("rejects an invalid quote query", async () => {
      const response = await request(app)
        .get("/api/v1/delivery-zones/quote")
        .query({ state: "FCT" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
      expect(mocks.quoteDeliveryFee).not.toHaveBeenCalled();
    });

    it("returns 422 when the destination is not served", async () => {
      mocks.quoteDeliveryFee.mockRejectedValue(
        new AppError("We do not currently deliver to Wuse, FCT", 422),
      );

      const response = await request(app)
        .get("/api/v1/delivery-zones/quote")
        .query({ state: "FCT", city: "Wuse" });

      expect(response.status).toBe(422);
      expect(response.body.message).toBe(
        "We do not currently deliver to Wuse, FCT",
      );
    });
  });
});
