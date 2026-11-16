import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: wishlist tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const { addWishlistItem, getWishlist, removeWishlistItem, moveWishlistItemToCart, disconnectDatabase } =
  await import("../src/modules/wishlist/wishlist.service").then(async (service) => {
    const database = await import("../src/infrastructure/prisma/client");
    return {
      addWishlistItem: service.addWishlistItem,
      getWishlist: service.getWishlist,
      removeWishlistItem: service.removeWishlistItem,
      moveWishlistItemToCart: service.moveWishlistItemToCart,
      disconnectDatabase: database.disconnectDatabase,
    };
  });

interface Fixture {
  userIds: string[];
  categoryId: string;
  productIds: string[];
  variantIds: string[];
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture: Fixture = {
    userIds: [randomUUID(), randomUUID()],
    categoryId: randomUUID(),
    productIds: [randomUUID(), randomUUID()],
    variantIds: [randomUUID(), randomUUID()],
  };

  await pool.query(
    `INSERT INTO users (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'Wishlist', 'Customer', NOW(), NOW()),
            ($3, $4, 'test-hash', 'Other', 'Customer', NOW(), NOW())`,
    [fixture.userIds[0], `wishlist-${suffix}@example.test`, fixture.userIds[1], `other-${suffix}@example.test`],
  );
  await pool.query(
    `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [fixture.categoryId, `Wishlist ${suffix}`, `wishlist-${suffix}`],
  );

  for (let index = 0; index < 2; index++) {
    await pool.query(
      `INSERT INTO products
       (id, "categoryId", name, slug, description, "basePrice", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Wishlist fixture', 100, $5, NOW(), NOW())`,
      [fixture.productIds[index], fixture.categoryId, `Wishlist Product ${index}`, `wishlist-product-${suffix}-${index}`, index === 0],
    );
    await pool.query(
      `INSERT INTO product_variants (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Standard', 100, NOW(), NOW())`,
      [fixture.variantIds[index], fixture.productIds[index], `WISH-${fixture.variantIds[index]}`],
    );
    await pool.query(
      `INSERT INTO inventory (id, "productVariantId", quantity, "reservedQuantity", "quarantineQuantity", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 2, 1, NOW(), NOW())`,
      [randomUUID(), fixture.variantIds[index], index === 0 ? 10 : 0],
    );
  }

  await pool.query(
    `INSERT INTO product_images (id, "productId", url, "altText", "sortOrder", "isPrimary", "createdAt")
     VALUES ($1, $2, 'https://example.test/wishlist.jpg', 'Wishlist image', 0, true, NOW())`,
    [randomUUID(), fixture.productIds[0]],
  );

  return fixture;
}

async function cleanupFixture(fixture: Fixture) {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fixture.userIds]);
  await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fixture.productIds]);
  await pool.query(`DELETE FROM categories WHERE id = $1`, [fixture.categoryId]);
}

describe("PostgreSQL customer wishlist", () => {
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

  it("adds products once and returns product, variant, image, and availability details", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);
      const result = await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);
      expect(result.itemCount).toBe(1);
      expect(result.items[0].product).toMatchObject({
        id: fixture.productIds[0],
        isActive: true,
        isAvailable: true,
        image: { altText: "Wishlist image" },
      });
      expect(result.items[0].product.variants[0]).toMatchObject({
        isAvailable: true,
        availableQuantity: 7,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects inactive products but retains previously saved items with unavailable status", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);
      await pool.query(`UPDATE products SET "isActive" = false WHERE id = $1`, [fixture.productIds[0]]);
      const result = await getWishlist(fixture.userIds[0]);
      expect(result.items[0].product.isActive).toBe(false);
      expect(result.items[0].product.isAvailable).toBe(false);
      await expect(addWishlistItem(fixture.userIds[0], fixture.productIds[1])).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await cleanupFixture(fixture);
    }
  });


  it("handles concurrent duplicate additions without creating duplicate rows", async () => {
    const fixture = await createFixture();
    try {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          addWishlistItem(fixture.userIds[0], fixture.productIds[0]),
        ),
      );

      const result = await getWishlist(fixture.userIds[0]);
      expect(result.itemCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("moves a selected variant into the cart and removes the wishlist entry atomically", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);

      const cart = await moveWishlistItemToCart(
        fixture.userIds[0],
        fixture.productIds[0],
        { productVariantId: fixture.variantIds[0], quantity: 2 },
      );

      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({
        productVariantId: fixture.variantIds[0],
        productId: fixture.productIds[0],
        quantity: 2,
        isAvailable: true,
      });
      expect((await getWishlist(fixture.userIds[0])).itemCount).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps the wishlist entry when the selected variant does not belong to the saved product", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);

      await expect(
        moveWishlistItemToCart(
          fixture.userIds[0],
          fixture.productIds[0],
          { productVariantId: fixture.variantIds[1], quantity: 1 },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });

      expect((await getWishlist(fixture.userIds[0])).itemCount).toBe(1);
      const cart = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM cart_items ci
         INNER JOIN carts c ON c.id = ci."cartId"
         WHERE c."userId" = $1`,
        [fixture.userIds[0]],
      );
      expect(cart.rows[0].count).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps the wishlist entry when cart stock validation rejects the requested quantity", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);

      await expect(
        moveWishlistItemToCart(
          fixture.userIds[0],
          fixture.productIds[0],
          { productVariantId: fixture.variantIds[0], quantity: 8 },
        ),
      ).rejects.toMatchObject({ statusCode: 409 });

      expect((await getWishlist(fixture.userIds[0])).itemCount).toBe(1);
      const cart = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM cart_items ci
         INNER JOIN carts c ON c.id = ci."cartId"
         WHERE c."userId" = $1`,
        [fixture.userIds[0]],
      );
      expect(cart.rows[0].count).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a wishlist add that races with product deactivation", async () => {
    const fixture = await createFixture();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE products SET "isActive" = false WHERE id = $1`,
        [fixture.productIds[0]],
      );

      const adding = expect(
        addWishlistItem(fixture.userIds[0], fixture.productIds[0]),
      ).rejects.toMatchObject({ statusCode: 404 });
      await client.query("COMMIT");

      await adding;
      expect((await getWishlist(fixture.userIds[0])).itemCount).toBe(0);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
        await cleanupFixture(fixture);
      }
    }
  });

  it("isolates wishlist ownership and returns 404 when another customer removes an item", async () => {
    const fixture = await createFixture();
    try {
      await addWishlistItem(fixture.userIds[0], fixture.productIds[0]);
      expect((await getWishlist(fixture.userIds[1])).itemCount).toBe(0);
      await expect(removeWishlistItem(fixture.userIds[1], fixture.productIds[0])).rejects.toMatchObject({ statusCode: 404 });
      const result = await removeWishlistItem(fixture.userIds[0], fixture.productIds[0]);
      expect(result.itemCount).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
