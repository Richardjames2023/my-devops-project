import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Chat handoff notification tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
process.env.EMAIL_DELIVERY_ENABLED = "false";

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const [{ processNotificationOutboxBatch }, { disconnectDatabase }] = await Promise.all([
  import("../src/modules/notifications/notification-outbox.processor"),
  import("../src/infrastructure/prisma/client"),
]);

const ids = {
  conversation: randomUUID(),
  event: randomUUID(),
  eligibleStaff: randomUUID(),
  ineligibleStaff: randomUUID(),
  eligibleRole: randomUUID(),
  ineligibleRole: randomUUID(),
};

async function createStaff(staffId: string, roleId: string, roleName: string, permissionName: string) {
  await pool.query(
    `INSERT INTO staff_accounts
      (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Chat', 'Support', 'ACTIVE', NOW(), NOW())`,
    [staffId, `${staffId}@chat-handoff.test`],
  );
  await pool.query(
    `INSERT INTO roles (id, name, "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())`,
    [roleId, roleName],
  );
  await pool.query(
    `INSERT INTO permissions (id, name, "createdAt")
     VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING`,
    [randomUUID(), permissionName],
  );
  const permission = await pool.query(
    "SELECT id FROM permissions WHERE name = $1",
    [permissionName],
  );
  await pool.query(
    `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), roleId, permission.rows[0].id],
  );
  await pool.query(
    `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
     VALUES ($1, $2, $3, NOW())`,
    [randomUUID(), staffId, roleId],
  );
}

describe("Chat handoff notification fan-out (PostgreSQL)", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: chat handoff tests require shop_db_test");
    }

    await createStaff(ids.eligibleStaff, ids.eligibleRole, `CHAT_HANDOFF_ELIGIBLE_${ids.eligibleRole}`, "chat.read");
    await createStaff(ids.ineligibleStaff, ids.ineligibleRole, `CHAT_HANDOFF_INELIGIBLE_${ids.ineligibleRole}`, "orders.manage");

    await pool.query(
      `INSERT INTO chat_conversations
        (id, status, last_message_at, created_at, updated_at)
       VALUES ($1, 'WAITING_FOR_AGENT', NOW(), NOW(), NOW())`,
      [ids.conversation],
    );
    await pool.query(
      `INSERT INTO notification_preferences
        (id, "recipientType", "staffAccountId", category, "inAppEnabled", "emailEnabled", "createdAt", "updatedAt")
       VALUES ($1, 'STAFF', $2, 'STAFF', false, true, NOW(), NOW())`,
      [randomUUID(), ids.eligibleStaff],
    );
    await pool.query(
      `INSERT INTO notification_outbox
        (id, "eventKey", "eventType", "aggregateType", "aggregateId", payload,
         status, "attemptCount", "availableAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'chat.handoff_requested', 'CHAT', $3, $4::jsonb,
               'PENDING', 0, NOW(), NOW(), NOW())`,
      [
        ids.event,
        `chat-handoff:${ids.event}`,
        ids.conversation,
        JSON.stringify({ conversationId: ids.conversation, source: "customer" }),
      ],
    );
  });

  afterAll(async () => {
    try {
      await pool.query(
        'DELETE FROM notification_email_deliveries WHERE "eventRecipientKey" LIKE $1',
        [`v1:${ids.event}:%`],
      );
      await pool.query('DELETE FROM notifications WHERE "outboxEventId" = $1', [ids.event]);
      await pool.query("DELETE FROM notification_outbox WHERE id = $1", [ids.event]);
      await pool.query('DELETE FROM notification_preferences WHERE "staffAccountId" = ANY($1::uuid[])', [
        [ids.eligibleStaff, ids.ineligibleStaff],
      ]);
      await pool.query("DELETE FROM chat_conversations WHERE id = $1", [ids.conversation]);
      await pool.query('DELETE FROM staff_account_roles WHERE "staffAccountId" = ANY($1::uuid[])', [
        [ids.eligibleStaff, ids.ineligibleStaff],
      ]);
      await pool.query('DELETE FROM role_permissions WHERE "roleId" = ANY($1::uuid[])', [
        [ids.eligibleRole, ids.ineligibleRole],
      ]);
      await pool.query("DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])", [
        [ids.eligibleStaff, ids.ineligibleStaff],
      ]);
      await pool.query("DELETE FROM roles WHERE id = ANY($1::uuid[])", [
        [ids.eligibleRole, ids.ineligibleRole],
      ]);
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("notifies active chat readers regardless of routine preferences and never emails", async () => {
    await expect(processNotificationOutboxBatch({ eventId: ids.event })).resolves.toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });

    const notifications = await pool.query(
      `SELECT "recipientType", "staffAccountId", category, title, body, "actionUrl", metadata
       FROM notifications WHERE "outboxEventId" = $1`,
      [ids.event],
    );
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0]).toMatchObject({
      recipientType: "STAFF",
      staffAccountId: ids.eligibleStaff,
      category: "STAFF",
      title: "Customer support handoff requested",
      body: "A customer conversation is waiting for an agent.",
      actionUrl: `/staff/chat/conversations/${ids.conversation}`,
      metadata: { conversationId: ids.conversation, source: "customer" },
    });
    expect(notifications.rows[0].staffAccountId).not.toBe(ids.ineligibleStaff);

    const emails = await pool.query(
      'SELECT id FROM notification_email_deliveries WHERE "eventRecipientKey" LIKE $1',
      [`v1:${ids.event}:%`],
    );
    expect(emails.rows).toHaveLength(0);

    const event = await pool.query(
      'SELECT status FROM notification_outbox WHERE id = $1',
      [ids.event],
    );
    expect(event.rows[0]?.status).toBe("PROCESSED");
  });
});
