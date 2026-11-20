import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Chat realtime broadcast tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "chat-realtime-broadcast-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

const [
  chatService,
  staffChatService,
  prismaModule,
  realtimeEvents,
] = await Promise.all([
  import("../src/modules/chat/chat.service"),
  import("../src/modules/chat/staff-chat.service"),
  import("../src/infrastructure/prisma/client"),
  import("../src/modules/chat/chat-realtime.events"),
]);

const { default: prisma, disconnectDatabase } = prismaModule;
const { setChatRealtimeServer } = realtimeEvents;

type Broadcast = { room: string; event: string; payload: any };

describe("Chat realtime event broadcasting (PostgreSQL)", () => {
  const customerId = randomUUID();
  const staffId = randomUUID();
  let conversationId: string;
  const broadcasts: Broadcast[] = [];

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: chat realtime tests require shop_db_test");
    }

    await pool.query(
      `INSERT INTO users
        (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, 'test-hash', 'Realtime', 'Customer', NOW(), NOW())`,
      [customerId, `chat-realtime-${customerId}@test.local`],
    );
    await pool.query(
      `INSERT INTO staff_accounts
        (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Realtime', 'Agent', 'ACTIVE', NOW(), NOW())`,
      [staffId, `chat-realtime-agent-${staffId}@test.local`],
    );

    setChatRealtimeServer({
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          broadcasts.push({ room, event, payload });
        },
      }),
    } as Parameters<typeof setChatRealtimeServer>[0]);
  });

  afterAll(async () => {
    try {
      setChatRealtimeServer(null);
      if (conversationId) {
        await pool.query(
          `DELETE FROM notification_outbox
           WHERE "aggregateType" = 'CHAT' AND "aggregateId" = $1`,
          [conversationId],
        );
        await pool.query("DELETE FROM chat_conversations WHERE id = $1", [conversationId]);
      }
      await pool.query("DELETE FROM users WHERE id = $1", [customerId]);
      await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("broadcasts persisted messages and lifecycle changes once to the conversation room", async () => {
    const owner = { type: "CUSTOMER" as const, id: customerId };
    const conversation = await chatService.createConversation(owner);
    conversationId = conversation.id;
    const room = `chat:conversation:${conversationId}`;

    const customerInput = {
      content: "I need help with my delivery.",
      clientMessageId: randomUUID(),
    };
    const customerMessage = await chatService.sendCustomerMessage(
      owner,
      conversationId,
      customerInput,
    );
    await chatService.sendCustomerMessage(owner, conversationId, customerInput);

    const waiting = await chatService.requestHumanHandoff(owner, conversationId);
    await chatService.requestHumanHandoff(owner, conversationId);

    const claimed = await staffChatService.claimStaffChatConversation(conversationId, staffId);
    await staffChatService.claimStaffChatConversation(conversationId, staffId);

    const staffInput = {
      content: "I can help you check that delivery.",
      clientMessageId: randomUUID(),
    };
    const staffMessage = await staffChatService.sendStaffChatMessage(
      conversationId,
      staffId,
      staffInput,
    );
    await staffChatService.sendStaffChatMessage(conversationId, staffId, staffInput);

    const closed = await staffChatService.closeStaffChatConversation(conversationId, staffId);
    await staffChatService.closeStaffChatConversation(conversationId, staffId);

    expect(waiting.status).toBe("WAITING_FOR_AGENT");
    expect(claimed.status).toBe("HUMAN_ACTIVE");
    expect(closed.status).toBe("CLOSED");

    const messageBroadcasts = broadcasts.filter((item) => item.event === "chat:message:new");
    expect(messageBroadcasts.map((item) => item.payload.id)).toEqual([
      customerMessage.id,
      expect.any(String),
      staffMessage.id,
    ]);
    expect(messageBroadcasts.every((item) => item.room === room)).toBe(true);
    expect(messageBroadcasts[0]?.payload.senderType).toBe("CUSTOMER");
    expect(messageBroadcasts[1]?.payload.senderType).toBe("SYSTEM");
    expect(messageBroadcasts[2]?.payload.senderType).toBe("AGENT");

    const statusBroadcasts = broadcasts.filter(
      (item) => item.event === "chat:conversation:status",
    );
    expect(statusBroadcasts.map((item) => item.payload.status)).toEqual([
      "WAITING_FOR_AGENT",
      "HUMAN_ACTIVE",
      "CLOSED",
    ]);
    expect(statusBroadcasts.every((item) => item.room === room)).toBe(true);

    const assignedBroadcasts = broadcasts.filter(
      (item) => item.event === "chat:conversation:assigned",
    );
    expect(assignedBroadcasts).toHaveLength(1);
    expect(assignedBroadcasts[0]?.payload).toMatchObject({
      conversationId,
      assignedAgent: { id: staffId, firstName: "Realtime", lastName: "Agent" },
    });

    for (const item of messageBroadcasts) {
      const persisted = await prisma.chatMessage.findUnique({
        where: { id: item.payload.id },
        select: { id: true, conversationId: true },
      });
      expect(persisted).toEqual({ id: item.payload.id, conversationId });
    }
  });
});
