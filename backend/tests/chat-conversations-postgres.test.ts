import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Chat tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "chat-conversations-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const [
  {
    createConversation,
    getConversation,
    listConversationMessages,
    listConversations,
    requestHumanHandoff,
    sendCustomerMessage,
  },
  { disconnectDatabase },
] = await Promise.all([
  import("../src/modules/chat/chat.service"),
  import("../src/infrastructure/prisma/client"),
]);

const customerIds: string[] = [];
const guestSessionIds: string[] = [];
const conversationIds: string[] = [];

async function createCustomerOwner() {
  const id = randomUUID();
  customerIds.push(id);
  await pool.query(
    `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'Chat', 'Customer', NOW(), NOW())`,
    [id, `chat-${id}@test.local`],
  );
  return { type: "CUSTOMER" as const, id };
}

async function createGuestOwner() {
  const id = randomUUID();
  guestSessionIds.push(id);
  await pool.query(
    `INSERT INTO guest_sessions
      (id, "tokenHash", "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, NOW() + INTERVAL '1 day', NOW(), NOW())`,
    [id, randomUUID().replace(/-/g, "").padEnd(64, "a")],
  );
  return { type: "GUEST" as const, id };
}

describe("Chat conversation foundation (PostgreSQL)", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: chat tests require shop_db_test");
    }
  });

  afterAll(async () => {
    if (conversationIds.length > 0) {
      await pool.query(
        "DELETE FROM chat_conversations WHERE id = ANY($1::uuid[])",
        [conversationIds],
      );
    }
    if (customerIds.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [customerIds]);
    }
    if (guestSessionIds.length > 0) {
      await pool.query(
        "DELETE FROM guest_sessions WHERE id = ANY($1::uuid[])",
        [guestSessionIds],
      );
    }
    await disconnectDatabase();
    await pool.end();
  });

  it("creates a customer conversation and prevents another customer from reading it", async () => {
    const owner = await createCustomerOwner();
    const otherOwner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);

    expect(conversation.status).toBe("BOT_ACTIVE");
    await expect(getConversation(owner, conversation.id)).resolves.toMatchObject({
      id: conversation.id,
      status: "BOT_ACTIVE",
    });
    await expect(getConversation(otherOwner, conversation.id))
      .rejects.toMatchObject({ statusCode: 404 });

    const listed = await listConversations(owner, 20);
    expect(listed.items.map((item) => item.id)).toContain(conversation.id);
    const otherList = await listConversations(otherOwner, 20);
    expect(otherList.items).toHaveLength(0);
  });

  it("persists customer messages idempotently and paginates history in chronological order", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);

    const clientMessageId = randomUUID();
    const first = await sendCustomerMessage(owner, conversation.id, {
      content: "I need help with my order.",
      clientMessageId,
    });
    const retry = await sendCustomerMessage(owner, conversation.id, {
      content: "I need help with my order.",
      clientMessageId,
    });
    expect(retry.id).toBe(first.id);

    await sendCustomerMessage(owner, conversation.id, {
      content: "It has not arrived yet.",
      clientMessageId: randomUUID(),
    });
    await pool.query(
      `UPDATE chat_messages SET created_at = NOW() - INTERVAL '2 seconds'
       WHERE "conversation_id" = $1 AND "sender_type" = 'SYSTEM'`,
      [conversation.id],
    );

    const firstPage = await listConversationMessages(owner, conversation.id, 2);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.items[0]?.createdAt.getTime())
      .toBeLessThanOrEqual(firstPage.items[1]?.createdAt.getTime() ?? 0);

    const secondPage = await listConversationMessages(
      owner,
      conversation.id,
      2,
      firstPage.nextCursor ?? undefined,
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.content).toContain("Thanks for contacting");
    expect(secondPage.nextCursor).toBeNull();

    const count = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chat_messages WHERE "conversation_id" = $1 AND "sender_type" = \'CUSTOMER\'',
      [conversation.id],
    );
    expect(count.rows[0].count).toBe(2);
  });

  it("transitions a bot conversation to handoff once under concurrent requests", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);

    const results = await Promise.all([
      requestHumanHandoff(owner, conversation.id),
      requestHumanHandoff(owner, conversation.id),
    ]);
    expect(results.every((result) => result.status === "WAITING_FOR_AGENT")).toBe(true);

    const events = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chat_events WHERE "conversation_id" = $1 AND "event_type" = \'HANDOFF_REQUESTED\'',
      [conversation.id],
    );
    expect(events.rows[0].count).toBe(1);

    const systemMessages = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chat_messages WHERE "conversation_id" = $1 AND "sender_type" = \'SYSTEM\' AND content LIKE \'Your request has been sent%\'',
      [conversation.id],
    );
    expect(systemMessages.rows[0].count).toBe(1);
  });

  it("supports guest-owned conversations through the existing guest-session relation", async () => {
    const owner = await createGuestOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);

    await expect(getConversation(owner, conversation.id)).resolves.toMatchObject({
      id: conversation.id,
      status: "BOT_ACTIVE",
    });
    await expect(getConversation(
      { type: "GUEST", id: randomUUID() },
      conversation.id,
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});
