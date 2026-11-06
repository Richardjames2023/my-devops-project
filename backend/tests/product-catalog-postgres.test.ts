import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: product catalog tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { listCatalogProducts, getCatalogProductBySlug, listActiveCategories, disconnectDatabase } =
  await import("../src/modules/products/product.service").then(async (service) => {
    const database = await import("../src/infrastructure/prisma/client");
    return {
      listCatalogProducts: service.listCatalogProducts,
      getCatalogProductBySlug: service.getCatalogProductBySlug,
      listActiveCategories: (await import("../src/modules/products/category.service")).listActiveCategories,
      disconnectDatabase: database.disconnectDatabase,
    };
  });

interface Fixture {
  categoryId: string;
  productIds: string[];
  variantIds: string[];
  inventoryIds: string[];
  imageIds: string[];
}

async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    categoryId: randomUUID(),
    productIds: [randomUUID(), randomUUID(), randomUUID()],
    variantIds: [randomUUID(), randomUUID()],
    inventoryIds: [randomUUID(), randomUUID()],
    imageIds: [randomUUID(), randomUUID()],
  };

  const suffix = randomUUID();

  try {
    await pool.query(
      `INSERT INTO categories
       (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [fixture.categoryId, `Catalog Test ${suffix}`, `catalog-test-${suffix}`],
    );

    // This product deliberately has two variant prices with a gap between them.
    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, description, "basePrice",
        "hasWarranty", "warrantyDuration", "warrantyTerms",
        "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 300, true, 12, $6, NOW(), NOW())`,
      [
        fixture.productIds[0],
        fixture.categoryId,
        "Catalog Multi Variant",
        `catalog-multi-${suffix}`,
        "Searchable catalog integration fixture",
        "Manufacturer warranty",
      ],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 200, NOW(), NOW())`,
      [
        fixture.productIds[1],
        fixture.categoryId,
        "Catalog Base Price",
        `catalog-base-${suffix}`,
      ],
    );

    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, "basePrice", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 50, false, NOW(), NOW())`,
      [
        fixture.productIds[2],
        fixture.categoryId,
        "Catalog Inactive",
        `catalog-inactive-${suffix}`,
      ],
    );

    for (let index = 0; index < 2; index++) {
      await pool.query(
        `INSERT INTO product_variants
         (id, "productId", sku, name, price, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          fixture.variantIds[index],
          fixture.productIds[0],
          `CATALOG-${fixture.variantIds[index]}`,
          index === 0 ? "Budget Variant" : "Premium Variant",
          index === 0 ? 100 : 500,
        ],
      );

      await pool.query(
        `INSERT INTO inventory
         (id, "productVariantId", quantity, "reservedQuantity",
          "quarantineQuantity", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          fixture.inventoryIds[index],
          fixture.variantIds[index],
          index === 0 ? 10 : 4,
          index === 0 ? 3 : 1,
          index === 0 ? 2 : 1,
        ],
      );
    }

    await pool.query(
      `INSERT INTO product_images
       (id, "productId", url, "altText", "sortOrder", "isPrimary", "createdAt")
       VALUES
       ($1, $2, 'https://example.test/secondary.jpg', 'Secondary', 0, false, NOW()),
       ($3, $2, 'https://example.test/primary.jpg', 'Primary', 5, true, NOW())`,
      [
        fixture.imageIds[0],
        fixture.productIds[0],
        fixture.imageIds[1],
      ],
    );

    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(`DELETE FROM product_images WHERE id = ANY($1::uuid[])`, [
    fixture.imageIds,
  ]);
  await pool.query(`DELETE FROM inventory WHERE id = ANY($1::uuid[])`, [
    fixture.inventoryIds,
  ]);
  await pool.query(`DELETE FROM product_variants WHERE id = ANY($1::uuid[])`, [
    fixture.variantIds,
  ]);
  await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [
    fixture.productIds,
  ]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [
    fixture.categoryId,
  ]);
}

describe("PostgreSQL product catalog queries", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
  });

  it("applies a price range to one matching variant, not different variants", async () => {
    const fixture = await createFixture();

    try {
      const noMatch = await listCatalogProducts({
        minPrice: "150",
        maxPrice: "450",
        sort: "newest",
        page: 1,
        limit: 12,
      });

      expect(
        noMatch.items.some((item) => item.id === fixture.productIds[0]),
      ).toBe(false);

      const matchingRange = await listCatalogProducts({
        minPrice: "450",
        maxPrice: "550",
        sort: "newest",
        page: 1,
        limit: 12,
      });

      expect(
        matchingRange.items.some((item) => item.id === fixture.productIds[0]),
      ).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("subtracts reserved and quarantined stock and orders primary images first", async () => {
    const fixture = await createFixture();

    try {
      const result = await listCatalogProducts({
        q: "searchable catalog integration",
        sort: "newest",
        page: 1,
        limit: 12,
      });

      const product = result.items.find(
        (item) => item.id === fixture.productIds[0],
      );

      expect(product).toBeDefined();
      expect(product?.variants).toHaveLength(2);
      expect(product?.variants[0]).toMatchObject({
        name: "Budget Variant",
        availableQuantity: 5,
        inStock: true,
      });
      expect(product?.variants[1]).toMatchObject({
        name: "Premium Variant",
        availableQuantity: 2,
        inStock: true,
      });
      expect(product?.images[0].altText).toBe("Primary");
      expect(product?.priceFrom).toBe("100.00");
      expect(product?.priceTo).toBe("500.00");
      expect(product?.hasWarranty).toBe(true);
      expect(product?.warrantyDuration).toBe(12);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("uses basePrice when there are no active variants and excludes inactive products", async () => {
    const fixture = await createFixture();

    try {
      const result = await listCatalogProducts({
        sort: "newest",
        page: 1,
        limit: 12,
      });

      const basePriceProduct = result.items.find(
        (item) => item.id === fixture.productIds[1],
      );

      expect(basePriceProduct?.priceFrom).toBe("200.00");
      expect(basePriceProduct?.priceTo).toBe("200.00");
      expect(basePriceProduct?.variants).toEqual([]);
      expect(
        result.items.some((item) => item.id === fixture.productIds[2]),
      ).toBe(false);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("sorts by the lowest active variant price and falls back to basePrice", async () => {
    const fixture = await createFixture();

    try {
      const ascending = await listCatalogProducts({
        sort: "price_asc",
        page: 1,
        limit: 12,
      });
      const descending = await listCatalogProducts({
        sort: "price_desc",
        page: 1,
        limit: 12,
      });

      const ascendingIds = ascending.items
        .filter((item) => fixture.productIds.slice(0, 2).includes(item.id))
        .map((item) => item.id);
      const descendingIds = descending.items
        .filter((item) => fixture.productIds.slice(0, 2).includes(item.id))
        .map((item) => item.id);

      // The variant product has basePrice 300 but its lowest active variant is 100.
      // The base-price-only product costs 200, so effective-price ordering differs
      // from sorting directly on products.basePrice.
      expect(ascendingIds).toEqual([
        fixture.productIds[0],
        fixture.productIds[1],
      ]);
      expect(descendingIds).toEqual([
        fixture.productIds[1],
        fixture.productIds[0],
      ]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("lists only active categories and counts only active products", async () => {
    const fixture = await createFixture();

    try {
      const result = await listActiveCategories();
      const category = result.find((item) => item.id === fixture.categoryId);

      expect(category).toBeDefined();
      expect(category?.productCount).toBe(2);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns active product details by slug and rejects inactive products", async () => {
    const fixture = await createFixture();

    try {
      const activeSlug = (
        await pool.query(`SELECT slug FROM products WHERE id = $1`, [
          fixture.productIds[0],
        ])
      ).rows[0].slug as string;

      const inactiveSlug = (
        await pool.query(`SELECT slug FROM products WHERE id = $1`, [
          fixture.productIds[2],
        ])
      ).rows[0].slug as string;

      const product = await getCatalogProductBySlug(activeSlug);
      expect(product.id).toBe(fixture.productIds[0]);
      expect(product.slug).toBe(activeSlug);

      await expect(getCatalogProductBySlug(inactiveSlug)).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
