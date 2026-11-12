import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  assignDelivery: vi.fn(),
  listAssignedDeliveries: vi.fn(),
  updateDeliveryStatus: vi.fn(),
  createDelivery: vi.fn(),
  createDeliveryAttempt: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaff },
  },
}));

vi.mock("../src/modules/delivery/delivery.service", () => ({
  assignDelivery: mocks.assignDelivery,
  listAssignedDeliveries: mocks.listAssignedDeliveries,
  updateDeliveryStatus: mocks.updateDeliveryStatus,
  createDelivery: mocks.createDelivery,
  createDeliveryAttempt: mocks.createDeliveryAttempt,
}));

vi.mock("../src/modules/delivery/delivery-tracking.service", () => ({
  updateDeliveryTracking: vi.fn(),
  getCustomerOrderDeliveryTracking: vi.fn(),
  getGuestOrderDeliveryTracking: vi.fn(),
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const deliveryId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";

function makeToken() {
  return jwt.sign(
    { identityType: "STAFF", roles: [], permissions: [] },
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

describe("Delivery Agent route permissions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findStaff.mockResolvedValue(
      staffRecord("DELIVERY_AGENT", ["deliveries.read", "deliveries.manage"]),
    );
    mocks.listAssignedDeliveries.mockResolvedValue([{ id: deliveryId }]);
    mocks.updateDeliveryStatus.mockResolvedValue({
      id: deliveryId,
      status: "PICKED_UP",
    });
  });

  it("allows an agent to list only their assigned deliveries", async () => {
    const response = await request(app)
      .get("/api/v1/deliveries/mine")
      .set("Authorization", "Bearer " + makeToken());

    expect(response.status).toBe(200);
    expect(response.body.deliveries).toEqual([{ id: deliveryId }]);
    expect(mocks.listAssignedDeliveries).toHaveBeenCalledWith(staffId);
  });

  it("allows an agent to update delivery status through the deliveries permission", async () => {
    const response = await request(app)
      .patch(`/api/v1/deliveries/${deliveryId}/status`)
      .set("Authorization", "Bearer " + makeToken())
      .send({ status: "PICKED_UP" });

    expect(response.status).toBe(200);
    expect(mocks.updateDeliveryStatus).toHaveBeenCalledWith(
      deliveryId,
      "PICKED_UP",
      {
        staffAccountId: staffId,
        canManageAllDeliveries: false,
      },
    );
  });

  it("does not expose the fulfillment queue to delivery agents", async () => {
    const response = await request(app)
      .get("/api/v1/fulfillments/ready-orders")
      .set("Authorization", "Bearer " + makeToken());

    expect(response.status).toBe(403);
  });

  it("does not grant an agent fulfillment-management access", async () => {
    const response = await request(app)
      .post("/api/v1/fulfillments")
      .set("Authorization", "Bearer " + makeToken())
      .send({});

    expect(response.status).toBe(403);
    expect(mocks.createDelivery).not.toHaveBeenCalled();
  });
});
