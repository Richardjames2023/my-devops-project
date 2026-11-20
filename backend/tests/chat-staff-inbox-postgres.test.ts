import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff chat tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??=
  "staff-chat-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

const [
  { createConversation, requestHumanHandoff },
  {
    claimStaffChatConversation,
    getStaffChatConversation,
    listStaffChatConversations,
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

async function createCustomerOwner() {
  const id = randomUUID();
  customerIds.push(id);
  await pool.query(
    `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'Chat', 'Customer', NOW(), NOW())`,
    [id, `staff-chat-${id}@test.local`],
  );
  return { type: "CUSTOMER" as const, id };
}

async function createStaffAccount(firstName: string) {
  const id = randomUUID();
  staffIds.push(id);
  await pool.query(
    `INSERT INTO staff_accounts
      (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Agent', 'ACTIVE', NOW(), NOW())`,
    [id, `agent-${id}@test.local`, firstName],
  );
  return id;
}

describe("Staff chat inbox and assignment (PostgreSQL)", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: staff chat tests require shop_db_test");
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
    if (staffIds.length > 0) {
      await pool.query(
        "DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])",
        [staffIds],
      );
    }
    await disconnectDatabase();
    await pool.end();
  });

  it("lists waiting conversations and returns their latest message preview", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);
    await requestHumanHandoff(owner, conversation.id);

    let cursor: string | undefined;
    let matchingConversation:
      | Awaited<ReturnType<typeof listStaffChatConversations>>["items"][number]
      | undefined;
    let pageCount = 0;

    do {
      const page = await listStaffChatConversations({
        status: "WAITING_FOR_AGENT",
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });

      matchingConversation = page.items.find(
        (item) => item.id === conversation.id,
      );

      if (page.nextCursor) {
        expect(page.items.at(-1)?.id).toBe(page.nextCursor);
      }

      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
    } while (!matchingConversation && cursor && pageCount < 1_000);

    expect(matchingConversation).toEqual(
      expect.objectContaining({
        id: conversation.id,
        status: "WAITING_FOR_AGENT",
        messages: [
          expect.objectContaining({
            senderType: "SYSTEM",
            content: expect.stringContaining("customer-care queue"),
          }),
        ],
      }),
    );
  });

  it("returns the transcript and lifecycle audit events to staff services", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);
    await requestHumanHandoff(owner, conversation.id);
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        conversationId: conversation.id,
        senderType: "CUSTOMER",
        content: `Historical customer message ${index + 1}`,
      })),
    });

    const firstPage = await getStaffChatConversation(conversation.id, {
      limit: 50,
    });
    expect(firstPage.messages).toHaveLength(50);
    expect(firstPage.messagePagination).toMatchObject({
      hasMore: true,
      nextCursor: firstPage.messages[0]?.id,
    });

    const secondPage = await getStaffChatConversation(conversation.id, {
      limit: 50,
      cursor: firstPage.messagePagination.nextCursor!,
    });
    expect(secondPage.messages).toHaveLength(50);
    expect(secondPage.messagePagination.hasMore).toBe(true);
    expect(
      secondPage.messages.some((message) =>
        firstPage.messages.some((first) => first.id === message.id),
      ),
    ).toBe(false);

    await expect(
      getStaffChatConversation(conversation.id, {
        limit: 50,
        cursor: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(firstPage.events).toEqual([
      expect.objectContaining({
        eventType: "HANDOFF_REQUESTED",
        previousStatus: "BOT_ACTIVE",
        newStatus: "WAITING_FOR_AGENT",
      }),
    ]);
  });

  it("allows only one concurrent agent claim and records one assignment event", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);
    await requestHumanHandoff(owner, conversation.id);

    const firstAgentId = await createStaffAccount("First");
    const secondAgentId = await createStaffAccount("Second");

    const results = await Promise.allSettled([
      claimStaffChatConversation(conversation.id, firstAgentId),
      claimStaffChatConversation(conversation.id, secondAgentId),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof claimStaffChatConversation>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
    });

    const claimed = await prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { status: true, assignedAgentId: true },
    });

    expect(claimed.status).toBe("HUMAN_ACTIVE");
    expect([firstAgentId, secondAgentId]).toContain(claimed.assignedAgentId);

    const events = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM chat_events
       WHERE "conversation_id" = $1
         AND "event_type" = 'AGENT_ASSIGNED'`,
      [conversation.id],
    );
    expect(events.rows[0].count).toBe(1);

    await expect(
      claimStaffChatConversation(conversation.id, claimed.assignedAgentId!),
    ).resolves.toMatchObject({
      id: conversation.id,
      status: "HUMAN_ACTIVE",
      assignedAgentId: claimed.assignedAgentId,
    });

    const afterRetry = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM chat_events
       WHERE "conversation_id" = $1
         AND "event_type" = 'AGENT_ASSIGNED'`,
      [conversation.id],
    );
    expect(afterRetry.rows[0].count).toBe(1);
  });

  it("rejects claiming a conversation that has not requested human support", async () => {
    const owner = await createCustomerOwner();
    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);
    const agentId = await createStaffAccount("Available");

    await expect(
      claimStaffChatConversation(conversation.id, agentId),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
