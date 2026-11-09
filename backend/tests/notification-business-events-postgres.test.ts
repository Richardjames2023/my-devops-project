import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Notification business event tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [{ processNotificationOutboxBatch }, { createStockMovement }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-outbox.processor"),
  import("../src/modules/inventory/stock-movement.service"),
  import("../src/infrastructure/prisma/client"),
]);

type Fixture = {
  userIds: string[];
  orderIds: string[];
  refundIds: string[];
  returnIds: string[];
  warrantyClaimIds: string[];
  orderItemIds: string[];
  variantIds: string[];
  productIds: string[];
  categoryIds: string[];
  inventoryIds: string[];
  staffIds: string[];
  roleIds: string[];
  outboxIds: string[];
  recipientEmails: string[];
};
const fixture: Fixture = {
  userIds: [], orderIds: [], refundIds: [], returnIds: [], warrantyClaimIds: [], orderItemIds: [],
  variantIds: [], productIds: [], categoryIds: [], inventoryIds: [], staffIds: [], roleIds: [], outboxIds: [], recipientEmails: [],
};

async function createCustomer(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${id}@notification-business.test`;
  await pool.query(
    `INSERT INTO users
     (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-password-hash', 'Business', 'Customer', NOW(), NOW())`,
    [id, email],
  );
  fixture.userIds.push(id);
  return { id, email };
}

async function createStaff(permissions: string[]): Promise<string> {
  const staffId = randomUUID();
  const roleId = randomUUID();
  const roleName = `TEST_NOTIFICATION_BUSINESS_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Business', 'Staff', 'ACTIVE', NOW(), NOW())`,
    [staffId, `${staffId}@notification-business.test`],
  );
  await pool.query(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())`,
    [roleId, roleName],
  );
  fixture.staffIds.push(staffId);
  fixture.roleIds.push(roleId);

  for (const permissionName of permissions) {
    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), permissionName],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = $1`,
      [permissionName],
    );
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), roleId, permission.rows[0].id],
    );
  }
  await pool.query(
    `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), staffId, roleId],
  );
  return staffId;
}

async function createOrder(customer: { id: string; email: string } | null) {
  const id = randomUUID();
  const orderNumber = `NOTIFY-${randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO orders
     (id, "userId", "customerName", "customerEmail", "orderNumber", status,
      subtotal, "discountAmount", "deliveryFee", "totalAmount", currency,
      "shippingAddress", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Business Customer', $3, $4, 'PENDING',
             2500, 0, 0, 2500, 'NGN', '{}'::jsonb, NOW(), NOW())`,
    [id, customer?.id ?? null, customer?.email ?? `guest-${id}@notification-business.test`, orderNumber],
  );
  fixture.orderIds.push(id);
  const email = customer?.email ?? `guest-${id}@notification-business.test`;
  fixture.recipientEmails.push(email);
  return { id, orderNumber, email };
}

async function createEvent(eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox
     (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
      status, "attemptCount", "availableAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
    [id, `business-event:${id}`, eventType, aggregateType, aggregateId, JSON.stringify(payload)],
  );
  fixture.outboxIds.push(id);
  return id;
}

async function cleanup() {
  await pool.query(
    `DELETE FROM notification_email_deliveries
     WHERE "recipientEmail" = ANY($1::text[])
        OR "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = ANY($2::uuid[]))`,
    [fixture.recipientEmails, fixture.outboxIds],
  );
  await pool.query(`DELETE FROM notifications WHERE "outboxEventId" = ANY($1::uuid[])`, [fixture.outboxIds]);
  await pool.query(`DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])`, [fixture.outboxIds]);
  await pool.query(`DELETE FROM refunds WHERE id = ANY($1::uuid[])`, [fixture.refundIds]);
  await pool.query(`DELETE FROM warranty_claims WHERE id = ANY($1::uuid[])`, [fixture.warrantyClaimIds]);
  await pool.query(`DELETE FROM return_requests WHERE id = ANY($1::uuid[])`, [fixture.returnIds]);
  await pool.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [fixture.orderItemIds]);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [fixture.orderIds]);
  await pool.query(`DELETE FROM stock_movements WHERE "inventoryId" = ANY($1::uuid[])`, [fixture.inventoryIds]);
  await pool.query(`DELETE FROM inventory WHERE id = ANY($1::uuid[])`, [fixture.inventoryIds]);
  await pool.query(`DELETE FROM product_variants WHERE id = ANY($1::uuid[])`, [fixture.variantIds]);
  await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [fixture.productIds]);
  await pool.query(`DELETE FROM categories WHERE id = ANY($1::uuid[])`, [fixture.categoryIds]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fixture.userIds]);
  await pool.query(`DELETE FROM staff_account_roles WHERE "staffAccountId" = ANY($1::uuid[])`, [fixture.staffIds]);
  await pool.query(`DELETE FROM role_permissions WHERE "roleId" = ANY($1::uuid[])`, [fixture.roleIds]);
  await pool.query(`DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`, [fixture.staffIds]);
  await pool.query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [fixture.roleIds]);
}

describe("PostgreSQL notification business event fan-out", () => {
  let staffId = "";

  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }
    staffId = await createStaff(["orders.manage", "refunds.manage", "returns.manage", "warranty.manage", "inventory.manage"]);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("routes a registered order event to the customer and order managers", async () => {
    const customer = await createCustomer();
    const order = await createOrder(customer);
    const eventId = await createEvent("order.created", "ORDER", order.id, { orderId: order.id });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "recipientType", "customerUserId", "staffAccountId", title
       FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(2);
    expect(notices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientType: "CUSTOMER", customerUserId: customer.id, title: "Your order has been placed" }),
      expect.objectContaining({ recipientType: "STAFF", staffAccountId: staffId, title: "New order received" }),
    ]));

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0]).toMatchObject({
      recipientEmail: customer.email,
      templateKey: "customer.order-created",
    });
  });

  it("sends guest order email without creating a fake customer inbox identity", async () => {
    const order = await createOrder(null);
    const eventId = await createEvent("order.created", "ORDER", order.id, { orderId: order.id });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const customerNotices = await pool.query(
      `SELECT id FROM notifications
       WHERE "outboxEventId" = $1 AND "recipientType" = 'CUSTOMER'`,
      [eventId],
    );
    const guestEmail = await pool.query(
      `SELECT "notificationId", "recipientEmail", "templateKey"
       FROM notification_email_deliveries WHERE "recipientEmail" = $1`,
      [order.email],
    );
    expect(customerNotices.rows).toHaveLength(0);
    expect(guestEmail.rows).toHaveLength(1);
    expect(guestEmail.rows[0]).toMatchObject({
      notificationId: null,
      recipientEmail: order.email,
      templateKey: "customer.order-created",
    });
  });


  it("notifies customers and return managers when a return request is created", async () => {
    const customer = await createCustomer();
    const order = await createOrder(customer);
    const returnId = randomUUID();
    await pool.query(
      `INSERT INTO return_requests
       (id, "orderId", "userId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'PENDING', NOW(), NOW())`,
      [returnId, order.id, customer.id],
    );
    fixture.returnIds.push(returnId);
    const eventId = await createEvent("return.requested", "RETURN", returnId, { returnRequestId: returnId });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "recipientType", "customerUserId", "staffAccountId", title
       FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(2);
    expect(notices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientType: "CUSTOMER", customerUserId: customer.id, title: "Return request received" }),
      expect.objectContaining({ recipientType: "STAFF", staffAccountId: staffId, title: "Return request requires review" }),
    ]));

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0].templateKey).toBe("customer.return-request-received");
  });

  it("notifies customers and warranty managers when a warranty claim is created", async () => {
    const customer = await createCustomer();
    const order = await createOrder(customer);
    const categoryId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const orderItemId = randomUUID();
    const claimId = randomUUID();
    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [categoryId, `Notification Category ${categoryId}`, `notification-category-${categoryId}`],
    );
    await pool.query(
      `INSERT INTO products (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Notification Laptop', $3, 2500, NOW(), NOW())`,
      [productId, categoryId, `notification-product-${productId}`],
    );
    await pool.query(
      `INSERT INTO product_variants (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Default', 2500, NOW(), NOW())`,
      [variantId, productId, `NOTIFY-SKU-${variantId}`],
    );
    await pool.query(
      `INSERT INTO order_items
       (id, "orderId", "productVariantId", "productName", "variantName", sku,
        quantity, "unitPrice", "totalPrice", "createdAt")
       VALUES ($1, $2, $3, 'Notification Laptop', 'Default', $4, 1, 2500, 2500, NOW())`,
      [orderItemId, order.id, variantId, `NOTIFY-SKU-${variantId}`],
    );
    await pool.query(
      `INSERT INTO warranty_claims
       (id, "orderItemId", quantity, "userId", "claimNumber", issue, "createdAt", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, 'Device will not start', NOW(), NOW())`,
      [claimId, orderItemId, customer.id, `WAR-${claimId.slice(0, 8)}`],
    );
    fixture.categoryIds.push(categoryId);
    fixture.productIds.push(productId);
    fixture.variantIds.push(variantId);
    fixture.orderItemIds.push(orderItemId);
    fixture.warrantyClaimIds.push(claimId);
    const eventId = await createEvent("warranty.claim.created", "WARRANTY", claimId, { warrantyClaimId: claimId });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "recipientType", "customerUserId", "staffAccountId", title
       FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(2);
    expect(notices.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientType: "CUSTOMER", customerUserId: customer.id, title: "Warranty claim received" }),
      expect.objectContaining({ recipientType: "STAFF", staffAccountId: staffId, title: "Warranty claim requires review" }),
    ]));

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0].templateKey).toBe("customer.warranty-claim-received");
  });


  it("notifies inventory managers when available stock crosses its low-stock threshold", async () => {
    const categoryId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const inventoryId = randomUUID();
    await pool.query(
      `INSERT INTO categories (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [categoryId, `Low Stock Category ${categoryId}`, `low-stock-category-${categoryId}`],
    );
    await pool.query(
      `INSERT INTO products (id, "categoryId", name, slug, "basePrice", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Low Stock Product', $3, 2500, NOW(), NOW())`,
      [productId, categoryId, `low-stock-product-${productId}`],
    );
    await pool.query(
      `INSERT INTO product_variants (id, "productId", sku, name, price, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Default', 2500, NOW(), NOW())`,
      [variantId, productId, `LOW-STOCK-SKU-${variantId}`],
    );
    await pool.query(
      `INSERT INTO inventory
       (id, "productVariantId", quantity, "reservedQuantity", "quarantineQuantity",
        "lowStockThreshold", "createdAt", "updatedAt")
       VALUES ($1, $2, 10, 0, 0, 5, NOW(), NOW())`,
      [inventoryId, variantId],
    );
    fixture.categoryIds.push(categoryId);
    fixture.productIds.push(productId);
    fixture.variantIds.push(variantId);
    fixture.inventoryIds.push(inventoryId);

    await createStockMovement({ inventoryId, type: "SOLD", quantity: 5, reason: "Low-stock notification test" });
    const event = await pool.query(
      `SELECT id FROM notification_outbox
       WHERE "eventType" = 'inventory.low_stock' AND "aggregateId" = $1
       ORDER BY "createdAt" DESC LIMIT 1`,
      [inventoryId],
    );
    expect(event.rows).toHaveLength(1);
    const eventId = event.rows[0].id as string;
    fixture.outboxIds.push(eventId);

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "staffAccountId", title, body FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(1);
    expect(notices.rows[0]).toMatchObject({
      staffAccountId: staffId,
      title: "Low stock alert",
    });
    expect(notices.rows[0].body).toContain("5 available units");
    const emails = await pool.query(
      `SELECT id FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(0);
  });

  it("routes refund intervention to staff with refunds.manage and queues mandatory email", async () => {
    const order = await createOrder(null);
    const refundId = randomUUID();
    await pool.query(
      `INSERT INTO refunds
       (id, "orderId", reference, status, amount, currency, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'NEEDS_ATTENTION', 2500, 'NGN', NOW(), NOW())`,
      [refundId, order.id, `REF-${refundId.slice(0, 8)}`],
    );
    fixture.refundIds.push(refundId);
    const eventId = await createEvent("refund.needs_attention", "REFUND", refundId, {
      refundId,
      orderId: order.id,
    });

    expect(await processNotificationOutboxBatch({ eventId }))
      .toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notices = await pool.query(
      `SELECT "staffAccountId", title FROM notifications WHERE "outboxEventId" = $1`,
      [eventId],
    );
    expect(notices.rows).toHaveLength(1);
    expect(notices.rows[0]).toMatchObject({
      staffAccountId: staffId,
      title: "Refund requires manual attention",
    });

    const emails = await pool.query(
      `SELECT "recipientEmail", "templateKey" FROM notification_email_deliveries
       WHERE "notificationId" IN (SELECT id FROM notifications WHERE "outboxEventId" = $1)`,
      [eventId],
    );
    expect(emails.rows).toHaveLength(1);
    expect(emails.rows[0].templateKey).toBe("staff.refund-needs-attention");
  });
});
