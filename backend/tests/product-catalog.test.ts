import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  listCatalogProducts: vi.fn(),
  getCatalogProductBySlug: vi.fn(),
  listActiveCategories: vi.fn(),
}));

vi.mock("../src/modules/products/product.service", () => ({
  createProduct: mocks.createProduct,
  listCatalogProducts: mocks.listCatalogProducts,
  getCatalogProductBySlug: mocks.getCatalogProductBySlug,
}));

vi.mock("../src/modules/products/category.service", () => ({
  listActiveCategories: mocks.listActiveCategories,
}));

import app from "../src/app.ts";

describe("public product catalog endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listCatalogProducts.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 12,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    mocks.getCatalogProductBySlug.mockResolvedValue({
      id: "product-id",
      slug: "sample-product",
    });
    mocks.listActiveCategories.mockResolvedValue([]);
  });

  it("lists products with default pagination", async () => {
    const response = await request(app).get("/api/v1/products");

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.limit).toBe(12);
    expect(mocks.listCatalogProducts).toHaveBeenCalledWith({
      sort: "newest",
      page: 1,
      limit: 12,
    });
  });

  it("passes search, category, price and sorting filters to the catalog service", async () => {
    const response = await request(app).get(
      "/api/v1/products?q=phone&category=phones&minPrice=100&maxPrice=500&sort=price_asc&page=2&limit=10",
    );

    expect(response.status).toBe(200);
    expect(mocks.listCatalogProducts).toHaveBeenCalledWith({
      q: "phone",
      category: "phones",
      minPrice: "100",
      maxPrice: "500",
      sort: "price_asc",
      page: 2,
      limit: 10,
    });
  });

  it("rejects invalid pagination and price ranges", async () => {
    const invalidPage = await request(app).get("/api/v1/products?page=0");
    expect(invalidPage.status).toBe(400);

    const invalidRange = await request(app).get(
      "/api/v1/products?minPrice=500&maxPrice=100",
    );
    expect(invalidRange.status).toBe(400);

    expect(mocks.listCatalogProducts).not.toHaveBeenCalled();
  });

  it("retrieves an active product by slug through the public route", async () => {
    const response = await request(app).get(
      "/api/v1/products/sample-product",
    );

    expect(response.status).toBe(200);
    expect(response.body.product.slug).toBe("sample-product");
    expect(mocks.getCatalogProductBySlug).toHaveBeenCalledWith(
      "sample-product",
    );
  });

  it("lists public product categories", async () => {
    mocks.listActiveCategories.mockResolvedValue([
      {
        id: "category-id",
        name: "Phones",
        slug: "phones",
        description: null,
        productCount: 3,
      },
    ]);

    const response = await request(app).get("/api/v1/categories");

    expect(response.status).toBe(200);
    expect(response.body.categories).toHaveLength(1);
    expect(response.body.categories[0].productCount).toBe(3);
    expect(mocks.listActiveCategories).toHaveBeenCalledOnce();
  });
});
