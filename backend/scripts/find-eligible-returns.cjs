require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    const result = await client.query(`
      SELECT
        o.id AS order_id,
        o."userId" AS user_id,
        p."deliveredAt" AS delivered_at,
        COUNT(DISTINCT oi.id) AS item_count
      FROM orders o
      JOIN order_items oi ON oi."orderId" = o.id
      JOIN fulfillments f ON f."orderId" = o.id
      JOIN packages pkg ON pkg."fulfillmentId" = f.id
      JOIN deliveries p ON p."packageId" = pkg.id
      WHERE p."deliveredAt" >= NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1
          FROM return_requests rr
          WHERE rr."orderId" = o.id
            AND rr."userId" = o."userId"
            AND rr.status IN (
              'PENDING',
              'UNDER_REVIEW',
              'APPROVED',
              'RECEIVED'
            )
        )
      GROUP BY o.id, o."userId", p."deliveredAt"
      ORDER BY p."deliveredAt" DESC
    `);

    console.table(result.rows);
  } catch (error) {
    console.error("Query failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
