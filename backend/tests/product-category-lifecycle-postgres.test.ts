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
    "Safety check failed: product lifecycle tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 6 });

const [
  { setCategoryActive },
  { createProduct, setProductActive },
  { setProductVariantActive },
  { disconnectDatabase },
] = await Promise.all([
  import("../src/modules/products/category.service"),
  import("../src/modules/products/product.service"),
  import("../src/modules/products/product-variant.service"),
  import("../src/infrastructure/prisma/client"),
]);

interface Fixture {
  categoryId: string;
  productId: string;
  inactiveProductId: string;
  variantId: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture: Fixture = {
    categoryId: randomUUID(),
    productId: randomUUID(),
    inactiveProductId: randomUUID(),
    variantId: randomUUID(),
  };

  await pool.query(
    `INSERT INTO categories
     (id, name, slug, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [fixture.categoryId, `Lifecycle ${suffix}`, `lifecycle-${suffix}`],
  );

  await pool.query(
    `INSERT INTO products
     (id, "categoryId", name, slug, "basePrice", "isActive", "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Lifecycle Active Product', $4, 100, true, NOW(), NOW()),
       ($2, $3, 'Lifecycle Inactive Product', $5, 100, false, NOW(), NOW())`,
    [
      fixture.productId,
      fixture.inactiveProductId,
      fixture.categoryId,
      `lifecycle-active-${suffix}`,
      `lifecycle-inactive-${suffix}`,
    ],
  );

  await pool.query(
    `INSERT INTO product_variants
     (id, "productId", sku, name, price, "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Lifecycle Variant', 100, false, NOW(), NOW())`,
    [
      fixture.variantId,
      fixture.inactiveProductId,
      `LIFECYCLE-${suffix}`,
    ],
  );

  return fixture;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const productIds = [fixture.productId, fixture.inactiveProductId];
  await pool.query(
    `DELETE FROM product_variants WHERE "productId" = ANY($1::uuid[])`,
    [productIds],
  );
  await pool.query(`DELETE FROM products WHERE "categoryId" = $1`, [
    fixture.categoryId,
  ]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [
    fixture.categoryId,
  ]);
}

async function deactivateFixtureProducts(fixture: Fixture): Promise<void> {
  await pool.query(
    `UPDATE products SET "isActive" = false WHERE "categoryId" = $1`,
    [fixture.categoryId],
  );
}

describe("PostgreSQL product/category lifecycle concurrency", () => {
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

  it("prevents category deactivation while active products remain", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        setCategoryActive(fixture.categoryId, false),
      ).rejects.toMatchObject({ statusCode: 409 });

      const result = await pool.query(
        `SELECT "isActive" FROM categories WHERE id = $1`,
        [fixture.categoryId],
      );
      expect(result.rows[0].isActive).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("prevents product activation under an inactive category", async () => {
    const fixture = await createFixture();
    try {
      await deactivateFixtureProducts(fixture);
      await pool.query(
        `UPDATE categories SET "isActive" = false WHERE id = $1`,
        [fixture.categoryId],
      );

      await expect(
        setProductActive(fixture.inactiveProductId, true),
      ).rejects.toMatchObject({ statusCode: 400 });

      const result = await pool.query(
        `SELECT "isActive" FROM products WHERE id = $1`,
        [fixture.inactiveProductId],
      );
      expect(result.rows[0].isActive).toBe(false);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("prevents variant activation while its parent product is inactive", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        setProductVariantActive(fixture.variantId, true),
      ).rejects.toMatchObject({ statusCode: 400 });

      const result = await pool.query(
        `SELECT "isActive" FROM product_variants WHERE id = $1`,
        [fixture.variantId],
      );
      expect(result.rows[0].isActive).toBe(false);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("prevents creating a product under an inactive category", async () => {
    const fixture = await createFixture();
    const suffix = randomUUID();
    try {
      await deactivateFixtureProducts(fixture);
      await pool.query(
        `UPDATE categories SET "isActive" = false WHERE id = $1`,
        [fixture.categoryId],
      );

      await expect(
        createProduct({
          categoryId: fixture.categoryId,
          name: "Rejected Lifecycle Product",
          slug: `rejected-lifecycle-${suffix}`,
          basePrice: "100.00",
          hasWarranty: false,
        }),
      ).rejects.toMatchObject({ statusCode: 400);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes category deactivation against product activation", async () => {
    const fixture = await createFixture();
    try {
      await deactivateFixtureProducts(fixture);

      const outcomes = await Promise.allSettled([
        setCategoryActive(fixture.categoryId, false),
        setProductActive(fixture.inactiveProductId, true),
      ]);

      expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);

      const result = await pool.query(
        `SELECT c."isActive" AS "categoryActive",
                p."isActive" AS "productActive"
         FROM categories c
         JOIN products p ON p."categoryId" = c.id
         WHERE c.id = $1 AND p.id = $2`,
        [fixture.categoryId, fixture.inactiveProductId],
      );

      const { categoryActive, productActive } = result.rows[0];
      expect(
        (categoryActive === false && productActive === false) ||
          (categoryActive === true && productActive === true),
      ).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes category deactivation against product creation", async () => {
    const fixture = await createFixture();
    const suffix = randomUUID();
    const slug = `concurrent-lifecycle-${suffix}`;

    try {
      await deactivateFixtureProducts(fixture);

      const outcomes = await Promise.allSettled([
        setCategoryActive(fixture.categoryId, false),
        createProduct({
          categoryId: fixture.categoryId,
          name: "Concurrent Lifecycle Product",
          slug,
          basePrice: "100.00",
          hasWarranty: false,
        }),
      ]);

      expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);

      const result = await pool.query(
        `SELECT c."isActive" AS "categoryActive",
                p.id AS "productId"
         FROM categories c
         LEFT JOIN products p ON p."categoryId" = c.id AND p.slug = $2
         WHERE c.id = $1`,
        [fixture.categoryId, slug],
      );

      const { categoryActive, productId } = result.rows[0];
      expect(
        (categoryActive === false && productId === null) ||
          (categoryActive === true && productId !== null),
      ).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
