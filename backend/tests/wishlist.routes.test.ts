import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  getWishlist: vi.fn(),
  addWishlistItem: vi.fn(),
  removeWishlistItem: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("../src/modules/wishlist/wishlist.service", () => ({
  getWishlist: mocks.getWishlist,
  addWishlistItem: mocks.addWishlistItem,
  removeWishlistItem: mocks.removeWishlistItem,
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: { user: { findUnique: mocks.findUser } },
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const customerId = "b2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";
const productId = "d2d7f4e1-5c3a-4b8d-9e6f-1a2c3d4e5f60";

function token(identityType: "CUSTOMER" | "STAFF" = "CUSTOMER") {
  return jwt.sign(
    { identityType, roles: [], permissions: [], sessionVersion: 0 },
    JWT_ACCESS_SECRET,
    { subject: customerId, expiresIn: "5m" },
  );
}

describe("customer wishlist HTTP endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUser.mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 0,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    });
    mocks.getWishlist.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.addWishlistItem.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.removeWishlistItem.mockResolvedValue({ items: [], itemCount: 0 });
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/wishlist");
    expect(response.status).toBe(401);
    expect(mocks.getWishlist).not.toHaveBeenCalled();
  });

  it("rejects staff identities", async () => {
    const response = await request(app)
      .get("/api/v1/wishlist")
      .set("Authorization", `Bearer ${token("STAFF")}`);
    expect(response.status).toBe(403);
    expect(mocks.getWishlist).not.toHaveBeenCalled();
  });

  it("retrieves the authenticated customer's wishlist", async () => {
    mocks.getWishlist.mockResolvedValue({ items: [{ id: "item" }], itemCount: 1 });
    const response = await request(app)
      .get("/api/v1/wishlist")
      .set("Authorization", `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.wishlist.itemCount).toBe(1);
    expect(mocks.getWishlist).toHaveBeenCalledWith(customerId);
  });

  it("validates product IDs before adding", async () => {
    const response = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${token()}`)
      .send({ productId: "not-a-uuid" });

    expect(response.status).toBe(400);
    expect(mocks.addWishlistItem).not.toHaveBeenCalled();
  });

  it("adds a product for the authenticated customer only", async () => {
    const response = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${token()}`)
      .send({ productId });

    expect(response.status).toBe(200);
    expect(mocks.addWishlistItem).toHaveBeenCalledWith(customerId, productId);
  });

  it("validates product IDs before removal", async () => {
    const response = await request(app)
      .delete("/api/v1/wishlist/not-a-uuid")
      .set("Authorization", `Bearer ${token()}`);

    expect(response.status).toBe(400);
    expect(mocks.removeWishlistItem).not.toHaveBeenCalled();
  });

  it("removes a product only from the authenticated customer's wishlist", async () => {
    const response = await request(app)
      .delete(`/api/v1/wishlist/${productId}`)
      .set("Authorization", `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(mocks.removeWishlistItem).toHaveBeenCalledWith(customerId, productId);
  });
});
