import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Chat realtime replay route tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "chat-realtime-replay-routes-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [
  { default: app },
  { generateAccessToken },
  { createConversation, requestHumanHandoff },
  { createGuestSession },
  { disconnectDatabase },
] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/modules/chat/chat.service"),
  import("../src/modules/guest-session/guest-session.service"),
  import("../src/infrastructure/prisma/client"),
]);

type Actor = { id: string; token: string };
const customerIds: string[] = [];
const conversationIds: string[] = [];
const guestSessionIds: string[] = [];
let customerRoleId: string;

async function createCustomer(): Promise<Actor> {
  const id = randomUUID();
  customerIds.push(id);
  await pool.query(
    `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'Replay', 'Customer', NOW(), NOW())`,
    [id, `chat-replay-route-${id}@test.local`],
  );
  await pool.query('UPDATE users SET "emailVerified" = TRUE WHERE id = $1', [id]);
  await pool.query(
    `INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("userId", "roleId") DO NOTHING`,
    [randomUUID(), id, customerRoleId],
  );
  return {
    id,
    token: generateAccessToken({
      sub: id,
      identityType: "CUSTOMER",
      roles: ["CUSTOMER"],
      permissions: [],
    }),
  };
}

describe("Chat realtime replay customer and guest HTTP routes (PostgreSQL)", () => {
  let customer: Actor;
  let otherCustomer: Actor;
  let customerConversationId: string;
  let guestConversationId: string;
  let guestCookie: string;

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: chat replay route tests require shop_db_test");
    }

    const customerRole = await pool.query(
      `INSERT INTO roles (id, name, description, "createdAt", "updatedAt")
       VALUES ($1, 'CUSTOMER', 'Customer role', NOW(), NOW())
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [randomUUID()],
    );
    customerRoleId = customerRole.rows[0].id;

    [customer, otherCustomer] = await Promise.all([
      createCustomer(),
      createCustomer(),
    ]);

    const customerConversation = await createConversation({
      type: "CUSTOMER",
      id: customer.id,
    });
    customerConversationId = customerConversation.id;
    conversationIds.push(customerConversationId);
    await requestHumanHandoff(
      { type: "CUSTOMER", id: customer.id },
      customerConversationId,
    );

    const guestSession = await createGuestSession();
    guestSessionIds.push(guestSession.session.id);
    guestCookie = `guest_session=${guestSession.token}`;

    const guestConversation = await createConversation({
      type: "GUEST",
      id: guestSession.session.id,
    });
    guestConversationId = guestConversation.id;
    conversationIds.push(guestConversationId);
    await requestHumanHandoff(
      { type: "GUEST", id: guestSession.session.id },
      guestConversationId,
    );
  });

  afterAll(async () => {
    try {
      if (conversationIds.length) {
        await pool.query(
          "DELETE FROM chat_conversations WHERE id = ANY($1::uuid[])",
          [conversationIds],
        );
      }
      if (guestSessionIds.length) {
        await pool.query(
          "DELETE FROM guest_sessions WHERE id = ANY($1::uuid[])",
          [guestSessionIds],
        );
      }
      if (customerIds.length) {
        await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [customerIds]);
      }
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("authorizes customer replay by conversation ownership and paginates in sequence order", async () => {
    const firstPage = await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events?after=0&limit=2`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.items.map((item: { sequence: number }) => item.sequence))
      .toEqual([1, 2]);
    expect(firstPage.body.data.items[0].event).toBe("chat:message:new");
    expect(firstPage.body.data.items[1].event).toBe("chat:conversation:status");
    expect(firstPage.body.data.hasMore).toBe(true);
    expect(firstPage.body.data.nextCursor).toBe(2);

    const secondPage = await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events`)
      .query({ after: firstPage.body.data.nextCursor, limit: 2 })
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(200);

    expect(secondPage.body.data.items).toHaveLength(1);
    expect(secondPage.body.data.items[0].sequence).toBe(3);
    expect(secondPage.body.data.hasMore).toBe(false);
    expect(secondPage.body.data.nextCursor).toBeNull();
    expect(secondPage.body.data.currentSequence).toBe(3);

    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events`)
      .set("Authorization", `Bearer ${otherCustomer.token}`)
      .expect(404);
  });

  it("requires a valid owner identity and validates customer replay cursors and limits", async () => {
    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events`)
      .expect(401);

    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events?after=-1`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(400);

    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events?limit=101`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(400);

    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events?after=999`)
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(400);
  });

  it("allows a valid guest-session cookie to replay only its own conversation", async () => {
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${guestConversationId}/events?after=0&limit=10`)
      .set("Cookie", guestCookie)
      .expect(200);

    expect(response.body.data.items.map((item: { sequence: number }) => item.sequence))
      .toEqual([1, 2, 3]);
    expect(response.body.data.items.map((item: { event: string }) => item.event)).toEqual([
      "chat:message:new",
      "chat:conversation:status",
      "chat:message:new",
    ]);

    await request(app)
      .get(`/api/v1/chat/conversations/${customerConversationId}/events`)
      .set("Cookie", guestCookie)
      .expect(404);
  });
});
