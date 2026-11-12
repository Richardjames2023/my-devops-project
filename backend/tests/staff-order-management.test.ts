import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  listStaffOrders: vi.fn(),
  getStaffOrder: vi.fn(),
  findStaffAccount: vi.fn(),
}));

vi.mock("../src/modules/orders/staff-order.service", () => ({
  listStaffOrders: mocks.listStaffOrders,
  getStaffOrder: mocks.getStaffOrder,
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: { staffAccount: { findUnique: mocks.findStaffAccount } },
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "b2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";
const orderId = "d2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";

function token(permissions: string[]) {
  return jwt.sign(
    { identityType: "STAFF", roles: [], permissions },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

describe("staff order management HTTP endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findStaffAccount.mockImplementation(async () => ({
      status: "ACTIVE",
      roles: [{
        role: {
          name: "ORDER_OPERATOR",
          permissions: [{ permission: { name: "orders.read" } }],
        },
      }],
    }));
    mocks.listStaffOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    mocks.getStaffOrder.mockResolvedValue({ id: orderId, orderNumber: "ORD-TEST" });
  });

  it("requires authentication for staff order listing", async () => {
    const response = await request(app).get("/api/v1/staff/orders");
    expect(response.status).toBe(401);
    expect(mocks.listStaffOrders).not.toHaveBeenCalled();
  });

  it("requires the orders.read permission", async () => {
    mocks.findStaffAccount.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { name: "DELIVERY_AGENT", permissions: [] } }],
    });
    const response = await request(app)
      .get("/api/v1/staff/orders")
      .set("Authorization", `Bearer ${token([])}`);
    expect(response.status).toBe(403);
    expect(mocks.listStaffOrders).not.toHaveBeenCalled();
  });

  it("lists orders with validated filters and pagination", async () => {
    const response = await request(app)
      .get("/api/v1/staff/orders?page=2&limit=25&search=ORD-123&status=CONFIRMED&paymentStatus=SUCCESS")
      .set("Authorization", `Bearer ${token(["orders.read"])}`);

    expect(response.status).toBe(200);
    expect(mocks.listStaffOrders).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      search: "ORD-123",
      status: "CONFIRMED",
      paymentStatus: "SUCCESS",
    });
    expect(response.body.pagination.total).toBe(0);
  });

  it("rejects invalid filters and date ranges", async () => {
    const response = await request(app)
      .get("/api/v1/staff/orders?page=0&limit=101&status=UNKNOWN&from=2026-11-20&to=2026-11-01")
      .set("Authorization", `Bearer ${token(["orders.read"])}`);
    expect(response.status).toBe(400);
    expect(mocks.listStaffOrders).not.toHaveBeenCalled();
  });

  it("returns order details for authorized staff", async () => {
    const response = await request(app)
      .get(`/api/v1/staff/orders/${orderId}`)
      .set("Authorization", `Bearer ${token(["orders.read"])}`);
    expect(response.status).toBe(200);
    expect(response.body.order.id).toBe(orderId);
    expect(mocks.getStaffOrder).toHaveBeenCalledWith(orderId);
  });

  it("rejects malformed order IDs", async () => {
    const response = await request(app)
      .get("/api/v1/staff/orders/not-a-uuid")
      .set("Authorization", `Bearer ${token(["orders.read"])}`);
    expect(response.status).toBe(400);
    expect(mocks.getStaffOrder).not.toHaveBeenCalled();
  });
});
