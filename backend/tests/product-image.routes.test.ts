import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  listProductImages: vi.fn(),
  createProductImages: vi.fn(),
  updateProductImage: vi.fn(),
  deleteProductImage: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaff },
  },
}));

vi.mock("../src/modules/products/product-image.service", () => ({
  listProductImages: mocks.listProductImages,
  createProductImages: mocks.createProductImages,
  updateProductImage: mocks.updateProductImage,
  deleteProductImage: mocks.deleteProductImage,
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const productId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";
const imageId = "a7e2b6c5-7d8f-8e9a-b0c1-2d3e4f5a6b7c";

function makeToken() {
  return jwt.sign(
    { identityType: "STAFF", roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

function authorizeAs(permissions: string[]) {
  mocks.findStaff.mockResolvedValue({
    status: "ACTIVE",
    roles: [{
      role: {
        name: "TEST_STAFF",
        permissions: permissions.map((name) => ({
          permission: { name },
        })),
      },
    }],
  });

  return { Authorization: "Bearer " + makeToken() };
}

describe("product image administration routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listProductImages.mockResolvedValue([]);
    mocks.createProductImages.mockResolvedValue([{ id: imageId }]);
    mocks.updateProductImage.mockResolvedValue({ id: imageId, altText: "Updated" });
    mocks.deleteProductImage.mockResolvedValue({
      id: imageId,
      deleted: true,
      cloudinaryCleanupPending: false,
    });
  });

  it("requires authentication to list product images", async () => {
    const response = await request(app).get(
      `/api/v1/products/${productId}/images`,
    );

    expect(response.status).toBe(401);
  });

  it("requires products.manage to access product image administration", async () => {
    const response = await request(app)
      .get(`/api/v1/products/${productId}/images`)
      .set(authorizeAs(["products.read"]));

    expect(response.status).toBe(403);
    expect(mocks.listProductImages).not.toHaveBeenCalled();
  });

  it("lists product images for authorized staff", async () => {
    const response = await request(app)
      .get(`/api/v1/products/${productId}/images`)
      .set(authorizeAs(["products.manage"]));

    expect(response.status).toBe(200);
    expect(response.body.images).toEqual([]);
    expect(mocks.listProductImages).toHaveBeenCalledWith(productId);
  });

  it("uploads multiple images using the images multipart field", async () => {
    const response = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(authorizeAs(["products.manage"]))
      .attach("images", Buffer.from("image-one"), {
        filename: "front.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("image-two"), {
        filename: "back.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(mocks.createProductImages).toHaveBeenCalledOnce();
    expect(mocks.createProductImages.mock.calls[0]?.[0]).toBe(productId);
    expect(mocks.createProductImages.mock.calls[0]?.[1]).toHaveLength(2);
  });

  it("rejects unexpected multipart field names", async () => {
    const response = await request(app)
      .post(`/api/v1/products/${productId}/images`)
      .set(authorizeAs(["products.manage"]))
      .attach("file", Buffer.from("image"), {
        filename: "front.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(mocks.createProductImages).not.toHaveBeenCalled();
  });

  it("rejects invalid product IDs before accessing the service", async () => {
    const response = await request(app)
      .get("/api/v1/products/not-a-uuid/images")
      .set(authorizeAs(["products.manage"]));

    expect(response.status).toBe(400);
    expect(mocks.listProductImages).not.toHaveBeenCalled();
  });

  it("validates image metadata updates", async () => {
    const response = await request(app)
      .patch(`/api/v1/products/${productId}/images/${imageId}`)
      .set(authorizeAs(["products.manage"]))
      .send({ sortOrder: -1 });

    expect(response.status).toBe(400);
    expect(mocks.updateProductImage).not.toHaveBeenCalled();
  });

  it("updates image metadata for authorized staff", async () => {
    const response = await request(app)
      .patch(`/api/v1/products/${productId}/images/${imageId}`)
      .set(authorizeAs(["products.manage"]))
      .send({ altText: "Updated", sortOrder: 2, isPrimary: true });

    expect(response.status).toBe(200);
    expect(mocks.updateProductImage).toHaveBeenCalledWith(
      productId,
      imageId,
      { altText: "Updated", sortOrder: 2, isPrimary: true },
    );
  });

  it("deletes a product image through the protected route", async () => {
    const response = await request(app)
      .delete(`/api/v1/products/${productId}/images/${imageId}`)
      .set(authorizeAs(["products.manage"]));

    expect(response.status).toBe(200);
    expect(mocks.deleteProductImage).toHaveBeenCalledWith(productId, imageId);
  });
});
