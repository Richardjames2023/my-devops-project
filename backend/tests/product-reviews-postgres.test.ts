import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Product review tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const ids = Object.fromEntries(
  ["user", "category", "product", "variant", "order", "item", "payment", "fulfillment", "package", "packageItem", "delivery"]
    .map((key) => [key, randomUUID()]),
) as Record<string, string>;

const service = await import("../src/modules/product-reviews/product-review.service");
const database = await import("../src/infrastructure/prisma/client");

describe("PostgreSQL verified product reviews", () => {
  beforeAll(async () => {
    const db = await pool.query("SELECT current_database() AS name");
    if (db.rows[0]?.name !== "shop_db_test") throw new Error("Wrong test database");

    await pool.query(
      `INSERT INTO users (id,email,"passwordHash","firstName","lastName","createdAt","updatedAt")
       VALUES ($1,$2,'test','Verified','Buyer',NOW(),NOW())`,
      [ids.user, `review-${ids.user}@example.test`],
    );
    await pool.query(
      `INSERT INTO categories (id,name,slug,"createdAt","updatedAt")
       VALUES ($1,$2,$3,NOW(),NOW())`,
      [ids.category, `Review ${ids.category}`, `review-${ids.category}`],
    );
    await pool.query(
      `INSERT INTO products (id,"categoryId",name,slug,"basePrice","createdAt","updatedAt")
       VALUES ($1,$2,'Review Product',$3,12000,NOW(),NOW())`,
      [ids.product, ids.category, `review-product-${ids.product}`],
    );
    await pool.query(
      `INSERT INTO product_variants (id,"productId",sku,name,price,"createdAt","updatedAt")
       VALUES ($1,$2,$3,'Standard',12000,NOW(),NOW())`,
      [ids.variant, ids.product, `SKU-${ids.variant}`],
    );
    await pool.query(
      `INSERT INTO orders (id,"userId","orderNumber",status,subtotal,"discountAmount","deliveryFee","totalAmount",currency,"shippingAddress","createdAt","updatedAt")
       VALUES ($1,$2,$3,'PROCESSING',12000,0,0,12000,'NGN','{}'::jsonb,NOW(),NOW())`,
      [ids.order, ids.user, `ORD-${ids.order}`],
    );
    await pool.query(
      `INSERT INTO order_items (id,"orderId","productVariantId","productName","variantName",sku,quantity,"unitPrice","discountAmount","totalPrice")
       VALUES ($1,$2,$3,'Review Product','Standard',$4,1,12000,0,12000)`,
      [ids.item, ids.order, ids.variant, `SKU-${ids.variant}`],
    );
    await pool.query(
      `INSERT INTO payments (id,"orderId",reference,provider,status,amount,currency,"createdAt","updatedAt")
       VALUES ($1,$2,$3,'PAYSTACK','SUCCESS',12000,'NGN',NOW(),NOW())`,
      [ids.payment, ids.order, `PAY-${ids.payment}`],
    );
    await pool.query(
      `INSERT INTO fulfillments (id,"orderId",status,"createdAt","updatedAt")
       VALUES ($1,$2,'PROCESSING',NOW(),NOW())`,
      [ids.fulfillment, ids.order],
    );
    await pool.query(
      `INSERT INTO packages (id,"fulfillmentId",status,"createdAt","updatedAt")
       VALUES ($1,$2,'IN_TRANSIT',NOW(),NOW())`,
      [ids.package, ids.fulfillment],
    );
    await pool.query(
      `INSERT INTO package_items (id,"packageId","orderItemId",quantity,"createdAt","updatedAt")
       VALUES ($1,$2,$3,1,NOW(),NOW())`,
      [ids.packageItem, ids.package, ids.item],
    );
    await pool.query(
      `INSERT INTO deliveries (id,"packageId",status) VALUES ($1,$2,'IN_TRANSIT')`,
      [ids.delivery, ids.package],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM product_reviews WHERE "productId"=$1', [ids.product]);
    await pool.query("DELETE FROM deliveries WHERE id=$1", [ids.delivery]);
    await pool.query("DELETE FROM package_items WHERE id=$1", [ids.packageItem]);
    await pool.query("DELETE FROM packages WHERE id=$1", [ids.package]);
    await pool.query("DELETE FROM fulfillments WHERE id=$1", [ids.fulfillment]);
    await pool.query("DELETE FROM payments WHERE id=$1", [ids.payment]);
    await pool.query("DELETE FROM order_items WHERE id=$1", [ids.item]);
    await pool.query("DELETE FROM orders WHERE id=$1", [ids.order]);
    await pool.query("DELETE FROM product_variants WHERE id=$1", [ids.variant]);
    await pool.query("DELETE FROM products WHERE id=$1", [ids.product]);
    await pool.query("DELETE FROM categories WHERE id=$1", [ids.category]);
    await pool.query("DELETE FROM users WHERE id=$1", [ids.user]);
    await database.disconnectDatabase();
    await pool.end();
  });

  it("requires a paid, fully delivered order and keeps unapproved reviews private", async () => {
    const input = {
      rating: 5,
      title: "Great product",
      comment: "The product quality is excellent.",
    };

    await expect(
      service.createProductReview(ids.user, ids.product, input),
    ).rejects.toMatchObject({ statusCode: 403 });

    await pool.query(
      `UPDATE packages SET status='DELIVERED' WHERE id=$1`,
      [ids.package],
    );
    await pool.query(
      `UPDATE deliveries SET status='DELIVERED',"deliveredAt"=NOW() WHERE id=$1`,
      [ids.delivery],
    );
    await pool.query(
      `UPDATE fulfillments SET status='FULFILLED',"completedAt"=NOW() WHERE id=$1`,
      [ids.fulfillment],
    );
    await pool.query(`UPDATE orders SET status='FULFILLED' WHERE id=$1`, [ids.order]);

    const review = await service.createProductReview(ids.user, ids.product, input);
    expect(review.status).toBe("PENDING");

    await expect(
      service.createProductReview(ids.user, ids.product, input),
    ).rejects.toMatchObject({ statusCode: 409 });

    let publicReviews = await service.listApprovedProductReviews(ids.product, { page: 1, limit: 10 });
    expect(publicReviews.summary.totalReviews).toBe(0);

    await service.moderateProductReview(review.id, "APPROVED");
    publicReviews = await service.listApprovedProductReviews(ids.product, { page: 1, limit: 10 });
    expect(publicReviews.summary).toEqual({ averageRating: 5, totalReviews: 1 });
    expect(publicReviews.reviews[0]).toMatchObject({ verifiedPurchase: true, customerName: "Verified" });

    const edited = await service.updateOwnProductReview(ids.user, ids.product, {
      rating: 4,
      comment: "After using it longer, I would give it four stars.",
    });
    expect(edited.status).toBe("PENDING");
    publicReviews = await service.listApprovedProductReviews(ids.product, { page: 1, limit: 10 });
    expect(publicReviews.summary.totalReviews).toBe(0);
  });
});
