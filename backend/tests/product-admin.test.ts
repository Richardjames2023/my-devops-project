import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  createProduct: vi.fn(),
  listAdminProducts: vi.fn(),
  getAdminProductById: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
  deactivateProduct: vi.fn(),
  createCategory: vi.fn(),
  listAdminCategories: vi.fn(),
  updateCategory: vi.fn(),
  setCategoryActive: vi.fn(),
  deactivateCategory: vi.fn(),
  createProductVariant: vi.fn(),
  updateProductVariant: vi.fn(),
  setProductVariantActive: vi.fn(),
  deactivateProductVariant: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    staffAccount: { findUnique: mocks.findStaff },
  },
}));

vi.mock("../src/modules/products/product.service", () => ({
  createProduct: mocks.createProduct,
  listAdminProducts: mocks.listAdminProducts,
  getAdminProductById: mocks.getAdminProductById,
  updateProduct: mocks.updateProduct,
  setProductActive: mocks.setProductActive,
  deactivateProduct: mocks.deactivateProduct,
  listCatalogProducts: vi.fn(),
  getCatalogProductBySlug: vi.fn(),
}));

vi.mock("../src/modules/products/category.service", () => ({
  createCategory: mocks.createCategory,
  listAdminCategories: mocks.listAdminCategories,
  updateCategory: mocks.updateCategory,
  setCategoryActive: mocks.setCategoryActive,
  deactivateCategory: mocks.deactivateCategory,
  listActiveCategories: vi.fn(),
}));

vi.mock("../src/modules/products/product-variant.service", () => ({
  createProductVariant: mocks.createProductVariant,
  updateProductVariant: mocks.updateProductVariant,
  setProductVariantActive: mocks.setProductVariantActive,
  deactivateProductVariant: mocks.deactivateProductVariant,
}));

import app from "../src/app.ts";
import { JWT_ACCESS_SECRET } from "../src/config/auth";

const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const productId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";
const categoryId = "f6d1a5b4-6c7e-7d8f-a9b0-1c2d3e4f5a6b";
const variantId = "a7e2b6c5-7d8f-8e9a-b0c1-2d3e4f5a6b7c";

function makeToken() {
  return jwt.sign(
    { identityType: "STAFF", roles: [], permissions: [] },
    JWT_ACCESS_SECRET,
    { subject: staffId, expiresIn: "5m" },
  );
}

function staffRecord(roleName: string, permissions: string[]) {
  return {
    status: "ACTIVE",
    roles: [{
      role: {
        name: roleName,
        permissions: permissions.map((name) => ({
          permission: { name },
        })),
      },
    }],
  };
}

function authorizeAs(roleName: string, permissions: string[]) {
  mocks.findStaff.mockResolvedValue(staffRecord(roleName, permissions));
  return { Authorization: "Bearer " + makeToken() };
}

describe("product and category administration routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listAdminProducts.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    mocks.listAdminCategories.mockResolvedValue([]);
    mocks.createProduct.mockResolvedValue({ id: productId });
    mocks.updateProduct.mockResolvedValue({ id: productId, name: "Updated product" });
    mocks.deactivateProduct.mockResolvedValue({ id: productId, isActive: false });
    mocks.createCategory.mockResolvedValue({ id: categoryId });
    mocks.updateCategory.mockResolvedValue({ id: categoryId, name: "Updated category" });
    mocks.deactivateCategory.mockResolvedValue({ id: categoryId, isActive: false });
    mocks.updateProductVariant.mockResolvedValue({ id: variantId, name: "Updated variant" });
    mocks.setProductVariantActive.mockResolvedValue({ id: variantId, isActive: false });
  });

  it("requires authentication for product administration", async () => {
    const response = await request(app).get("/api/v1/products/admin");
    expect(response.status).toBe(401);
  });

  it("requires products.manage to list all products, including inactive products", async () => {
    const response = await request(app)
      .get("/api/v1/products/admin?page=2&limit=10")
      .set(authorizeAs("INVENTORY_MANAGER", ["products.read"]));

    expect(response.status).toBe(403);
    expect(mocks.listAdminProducts).not.toHaveBeenCalled();
  });

  it("lists admin products for staff with products.manage", async () => {
    const response = await request(app)
      .get("/api/v1/products/admin?page=2&limit=10")
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]));

    expect(response.status).toBe(200);
    expect(mocks.listAdminProducts).toHaveBeenCalledWith(2, 10);
  });

  it("validates product update payloads before calling the service", async () => {
    const response = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]))
      .send({ basePrice: "not-a-price" });

    expect(response.status).toBe(400);
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("updates a product through the protected administration route", async () => {
    const response = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]))
      .send({ name: "Updated product" });

    expect(response.status).toBe(200);
    expect(mocks.updateProduct).toHaveBeenCalledWith(productId, {
      name: "Updated product",
    });
  });

  it("deactivates products instead of hard-deleting records", async () => {
    const response = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]));

    expect(response.status).toBe(200);
    expect(mocks.deactivateProduct).toHaveBeenCalledWith(productId);
  });

  it("requires categories.manage for category administration", async () => {
    const response = await request(app)
      .get("/api/v1/categories/admin")
      .set(authorizeAs("SUPPORT_STAFF", ["categories.read"]));

    expect(response.status).toBe(403);
    expect(mocks.listAdminCategories).not.toHaveBeenCalled();
  });

  it("creates categories for staff with categories.manage", async () => {
    const response = await request(app)
      .post("/api/v1/categories")
      .set(authorizeAs("BUSINESS_OWNER", ["categories.manage"]))
      .send({
        name: "Home Appliances",
        slug: "home-appliances",
        description: "Home and kitchen appliances",
      });

    expect(response.status).toBe(201);
    expect(mocks.createCategory).toHaveBeenCalledWith({
      name: "Home Appliances",
      slug: "home-appliances",
      description: "Home and kitchen appliances",
    });
  });

  it("rejects invalid category slugs", async () => {
    const response = await request(app)
      .post("/api/v1/categories")
      .set(authorizeAs("BUSINESS_OWNER", ["categories.manage"]))
      .send({ name: "Home Appliances", slug: "Home Appliances" });

    expect(response.status).toBe(400);
    expect(mocks.createCategory).not.toHaveBeenCalled();
  });

  it("updates product variants through the protected administration route", async () => {
    const response = await request(app)
      .patch(`/api/v1/product-variants/${variantId}`)
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]))
      .send({ price: "149.99" });

    expect(response.status).toBe(200);
    expect(mocks.updateProductVariant).toHaveBeenCalledWith(variantId, {
      price: "149.99",
    });
  });

  it("uses a soft deactivation for product variants", async () => {
    const response = await request(app)
      .delete(`/api/v1/product-variants/${variantId}`)
      .set(authorizeAs("BUSINESS_OWNER", ["products.manage"]));

    expect(response.status).toBe(200);
    expect(mocks.deactivateProductVariant).toHaveBeenCalledWith(variantId);
  });
});
