import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff chat reply tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "staff-chat-replies-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [
  { createConversation, requestHumanHandoff },
  {
    claimStaffChatConversation,
    closeStaffChatConversation,
    sendStaffChatMessage,
  },
  { default: prisma, disconnectDatabase },
] = await Promise.all([
  import("../src/modules/chat/chat.service"),
  import("../src/modules/chat/staff-chat.service"),
  import("../src/infrastructure/prisma/client"),
]);

const customerIds: string[] = [];
const staffIds: string[] = [];
const conversationIds: string[] = [];

async function createCustomer() {
  const id = randomUUID();
  customerIds.push(id);
  await pool.query(
    `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'Reply', 'Customer', NOW(), NOW())`,
    [id, `chat-reply-${id}@test.local`],
  );
  return { type: "CUSTOMER" as const, id };
}

async function createAgent(name: string) {
  const id = randomUUID();
  staffIds.push(id);
  await pool.query(
    `INSERT INTO staff_accounts
      (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Agent', 'ACTIVE', NOW(), NOW())`,
    [id, `chat-agent-${id}@test.local`, name],
  );
  return id;
}

describe("Staff chat replies and closure (PostgreSQL)", () => {
  let assignedAgentId: string;
  let otherAgentId: string;
  let activeConversationId: string;
  let waitingConversationId: string;

  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: staff chat reply tests require shop_db_test");
    }

    assignedAgentId = await createAgent("Assigned");
    otherAgentId = await createAgent("Other");

    const owner = await createCustomer();
    const active = await createConversation(owner);
    activeConversationId = active.id;
    conversationIds.push(active.id);
    await requestHumanHandoff(owner, active.id);
    await claimStaffChatConversation(active.id, assignedAgentId);

    const waiting = await createConversation(owner);
    waitingConversationId = waiting.id;
    conversationIds.push(waiting.id);
    await requestHumanHandoff(owner, waiting.id);
  });

  afterAll(async () => {
    try {
      if (conversationIds.length) {
        await pool.query(
          "DELETE FROM chat_conversations WHERE id = ANY($1::uuid[])",
          [conversationIds],
        );
      }
      if (customerIds.length) {
        await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [customerIds]);
      }
      if (staffIds.length) {
        await pool.query(
          "DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])",
          [staffIds],
        );
      }
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("allows only the assigned agent to reply and makes retries idempotent", async () => {
    const clientMessageId = randomUUID();
    const input = { content: "Hello, I can help with your order.", clientMessageId };

    await expect(
      sendStaffChatMessage(activeConversationId, otherAgentId, input),
    ).rejects.toMatchObject({ statusCode: 403 });

    const first = await sendStaffChatMessage(activeConversationId, assignedAgentId, input);
    const retry = await sendStaffChatMessage(activeConversationId, assignedAgentId, input);

    expect(first).toMatchObject({
      conversationId: activeConversationId,
      senderType: "AGENT",
      senderAgentId: assignedAgentId,
      content: input.content,
      clientMessageId,
    });
    expect(retry.id).toBe(first.id);
    await expect(
      sendStaffChatMessage(activeConversationId, assignedAgentId, {
        content: "Different content with the same idempotency key",
        clientMessageId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const count = await prisma.chatMessage.count({
      where: {
        conversationId: activeConversationId,
        senderType: "AGENT",
        clientMessageId,
      },
    });
    expect(count).toBe(1);

    const conversation = await prisma.chatConversation.findUniqueOrThrow({
      where: { id: activeConversationId },
      select: { lastMessageAt: true, status: true },
    });
    expect(conversation.status).toBe("HUMAN_ACTIVE");
    expect(conversation.lastMessageAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
  });

  it("rejects replies until a conversation is claimed", async () => {
    await expect(
      sendStaffChatMessage(waitingConversationId, assignedAgentId, {
        content: "This should not be sent yet.",
        clientMessageId: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("closes the active conversation once and records the closure event", async () => {
    const closed = await closeStaffChatConversation(activeConversationId, assignedAgentId);
    expect(closed).toMatchObject({
      id: activeConversationId,
      status: "CLOSED",
      assignedAgentId,
    });
    expect(closed.closedAt).toBeInstanceOf(Date);

    const retry = await closeStaffChatConversation(activeConversationId, assignedAgentId);
    expect(retry.status).toBe("CLOSED");

    const events = await prisma.chatEvent.findMany({
      where: {
        conversationId: activeConversationId,
        eventType: "CONVERSATION_CLOSED",
      },
      select: { actorAgentId: true, previousStatus: true, newStatus: true },
    });
    expect(events).toEqual([
      expect.objectContaining({
        actorAgentId: assignedAgentId,
        previousStatus: "HUMAN_ACTIVE",
        newStatus: "CLOSED",
      }),
    ]);
  });

  it("rejects new replies after closure and prevents another agent from closing", async () => {
    await expect(
      sendStaffChatMessage(activeConversationId, assignedAgentId, {
        content: "A late reply",
        clientMessageId: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      closeStaffChatConversation(activeConversationId, otherAgentId),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
