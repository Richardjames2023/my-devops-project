import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  knowledgeBase: {
    documentId: "CS-KB-001",
    status: "Approved",
    approved: true,
    content: "# Approved test knowledge base",
  },
}));

vi.mock("../src/modules/chat/ai/chat-ai.provider.factory", () => ({
  createChatAiProvider: () => ({
    name: "gemini",
    generateReply: mocks.generateReply,
  }),
}));

vi.mock("../src/modules/chat/ai/customer-support-knowledge-base", () => ({
  loadCustomerSupportKnowledgeBase: async () => mocks.knowledgeBase,
}));

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Chat AI tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??=
  "chat-ai-generation-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.CHAT_AI_ENABLED = "true";
process.env.CHAT_AI_KNOWLEDGE_BASE_APPROVED = "true";
process.env.GEMINI_API_KEY ??= "test-gemini-key";
process.env.NODE_ENV = "test";

const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
});

const [
  { createConversation, requestHumanHandoff, sendCustomerMessage },
  { generateChatAiReply },
  { default: prisma, disconnectDatabase },
  realtimeEvents,
] = await Promise.all([
  import("../src/modules/chat/chat.service"),
  import("../src/modules/chat/ai/chat-ai.service"),
  import("../src/infrastructure/prisma/client"),
  import("../src/modules/chat/chat-realtime.events"),
]);

const { setChatRealtimeServer } = realtimeEvents;
const broadcasts: Array<{ room: string; event: string; payload: any }> = [];

const customerIds: string[] = [];
const guestSessionIds: string[] = [];
const conversationIds: string[] = [];

async function createCustomerOwner() {
  const id = randomUUID();
  customerIds.push(id);

  await pool.query(
    `INSERT INTO users
      (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
     VALUES ($1, $2, 'test-hash', 'AI', 'Customer', NOW(), NOW())`,
    [id, `chat-ai-${id}@test.local`],
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

async function createCustomerMessage(
  owner: Awaited<ReturnType<typeof createCustomerOwner>>,
) {
  const conversation = await createConversation(owner);
  conversationIds.push(conversation.id);

  const message = await sendCustomerMessage(owner, conversation.id, {
    content: "How can I return a defective product?",
    clientMessageId: randomUUID(),
  });

  return { conversation, message };
}

const generatedReply = {
  reply: "Please submit a return request with photos or a video of the defect.",
  handoff: {
    recommended: false,
    reason: null,
  },
};

describe("Chat AI generation (PostgreSQL)", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");

    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error(
        "Safety check failed: chat AI tests require shop_db_test",
      );
    }

    setChatRealtimeServer({
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          broadcasts.push({ room, event, payload });
        },
      }),
    } as Parameters<typeof setChatRealtimeServer>[0]);
  });

  beforeEach(() => {
    mocks.knowledgeBase.documentId = "CS-KB-001";
    mocks.knowledgeBase.status = "Approved";
    mocks.knowledgeBase.approved = true;
    mocks.knowledgeBase.content = "# Approved test knowledge base";

    mocks.generateReply.mockReset();
    mocks.generateReply.mockResolvedValue(generatedReply);
  });

  afterAll(async () => {
    setChatRealtimeServer(null);
    if (conversationIds.length > 0) {
      await pool.query(
        `DELETE FROM notification_outbox
         WHERE "aggregateType" = 'CHAT' AND "aggregateId" = ANY($1::text[])`,
        [conversationIds],
      );
      await pool.query(
        "DELETE FROM chat_conversations WHERE id = ANY($1::uuid[])",
        [conversationIds],
      );
    }

    if (customerIds.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        customerIds,
      ]);
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

  it("generates and persists one bot reply", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("GENERATED");
    expect(result.botMessage).toMatchObject({
      senderType: "BOT",
      content: generatedReply.reply,
    });

    expect(mocks.generateReply).toHaveBeenCalledTimes(1);

    const generation = await prisma.chatAiGeneration.findUnique({
      where: { customerMessageId: message.id },
    });

    expect(generation).toMatchObject({
      status: "COMPLETED",
      attemptCount: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });

    const botMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "BOT",
        clientMessageId: message.id,
      },
    });

    expect(botMessages).toHaveLength(1);

    const botBroadcasts = broadcasts.filter(
      (item) =>
        item.event === "chat:message:new" &&
        item.payload.conversationId === conversation.id &&
        item.payload.senderType === "BOT",
    );
    expect(botBroadcasts).toHaveLength(1);
    expect(botBroadcasts[0]?.payload).toMatchObject({
      id: botMessages[0]?.id,
      content: generatedReply.reply,
    });
  });

  it("atomically hands off when AI recommends human support", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);
    const handoffReply = {
      reply: "A support agent will help you with this issue.",
      handoff: {
        recommended: true,
        reason: "The issue requires a manual account review.",
      },
    };

    mocks.generateReply.mockResolvedValueOnce(handoffReply);

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("HANDOFF_RECOMMENDED");
    expect(result.botMessage?.content).toBe(handoffReply.reply);

    const updatedConversation = await prisma.chatConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(updatedConversation.status).toBe("WAITING_FOR_AGENT");

    const events = await prisma.chatEvent.findMany({
      where: {
        conversationId: conversation.id,
        eventType: "HANDOFF_REQUESTED",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      previousStatus: "BOT_ACTIVE",
      newStatus: "WAITING_FOR_AGENT",
      metadata: {
        source: "ai",
        reason: handoffReply.handoff.reason,
      },
    });

    const handoffMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "SYSTEM",
        content: {
          startsWith: "Your request has been referred to customer care.",
        },
      },
    });
    expect(handoffMessages).toHaveLength(1);

    const conversationBroadcasts = broadcasts.filter(
      (item) => item.payload.conversationId === conversation.id,
    );
    expect(
      conversationBroadcasts.filter(
        (item) => item.event === "chat:message:new" &&
          ["BOT", "SYSTEM"].includes(item.payload.senderType),
      ),
    ).toHaveLength(2);
    expect(
      conversationBroadcasts.filter(
        (item) =>
          item.event === "chat:conversation:status" &&
          item.payload.status === "WAITING_FOR_AGENT",
      ),
    ).toHaveLength(1);

    const notificationEvents = await prisma.notificationOutbox.findMany({
      where: {
        eventType: "chat.handoff_requested",
        aggregateType: "CHAT",
        aggregateId: conversation.id,
      },
    });
    expect(notificationEvents).toHaveLength(1);
    expect(notificationEvents[0]?.payload).toEqual({
      conversationId: conversation.id,
      source: "ai",
      reason: handoffReply.handoff.reason,
    });

    expect(updatedConversation.lastMessageAt).toEqual(
      handoffMessages[0]?.createdAt,
    );

    const botMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "BOT",
        clientMessageId: message.id,
      },
    });
    expect(botMessages).toHaveLength(1);

    const generation = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });
    expect(generation.status).toBe("COMPLETED");
  });

  it("returns the existing bot reply for a duplicate completed request", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    const first = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    const second = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(first.status).toBe("GENERATED");
    expect(second.status).toBe("GENERATED");
    expect(second.botMessage?.id).toBe(first.botMessage?.id);
    expect(mocks.generateReply).toHaveBeenCalledTimes(1);
  });

  it("allows only one provider call for concurrent generation requests", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    const input = {
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    };

    const results = await Promise.all([
      generateChatAiReply(input),
      generateChatAiReply(input),
    ]);

    expect(mocks.generateReply).toHaveBeenCalledTimes(1);

    expect(
      results.some((result) =>
        ["GENERATED", "HANDOFF_RECOMMENDED"].includes(result.status),
      ),
    ).toBe(true);

    const botMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "BOT",
        clientMessageId: message.id,
      },
    });

    expect(botMessages).toHaveLength(1);
  });

  it("records provider failure and allows a controlled retry", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    mocks.generateReply
      .mockRejectedValueOnce(new Error("Simulated provider failure"))
      .mockResolvedValueOnce(generatedReply);

    const input = {
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    };

    const first = await generateChatAiReply(input);

    expect(first.status).toBe("UNAVAILABLE");

    const failed = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(failed.status).toBe("FAILED");
    expect(failed.failureCode).toBe("AI_GENERATION_FAILED");

    const second = await generateChatAiReply(input);

    expect(second.status).toBe("GENERATED");

    const completed = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.attemptCount).toBe(2);
    expect(mocks.generateReply).toHaveBeenCalledTimes(2);
  });

  it("reclaims an expired generation lease", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    await prisma.chatAiGeneration.create({
      data: {
        customerMessageId: message.id,
        status: "PROCESSING",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 5_000),
        attemptCount: 1,
      },
    });

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("GENERATED");

    const generation = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(generation.status).toBe("COMPLETED");
    expect(generation.attemptCount).toBe(2);
    expect(mocks.generateReply).toHaveBeenCalledTimes(1);
  });

  it("does not exceed the maximum generation attempts", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    await prisma.chatAiGeneration.create({
      data: {
        customerMessageId: message.id,
        status: "PROCESSING",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 5_000),
        attemptCount: 3,
      },
    });

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(mocks.generateReply).not.toHaveBeenCalled();

    const generation = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(generation.status).toBe("FAILED");
    expect(generation.failureCode).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(generation.attemptCount).toBe(3);
  });

  it("prevents a stale worker from overwriting a reclaimed generation", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    const input = {
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    };

    let resolveFirstProviderCall!: (value: typeof generatedReply) => void;

    let signalFirstProviderCall!: () => void;

    const firstProviderCallStarted = new Promise<void>((resolve) => {
      signalFirstProviderCall = resolve;
    });

    const delayedFirstProviderCall = new Promise<typeof generatedReply>(
      (resolve) => {
        resolveFirstProviderCall = resolve;
      },
    );

    const workerBReply = {
      reply: "Worker B completed the customer support response.",
      handoff: {
        recommended: false,
        reason: null,
      },
    };

    mocks.generateReply
      .mockImplementationOnce(async () => {
        signalFirstProviderCall();
        return delayedFirstProviderCall;
      })
      .mockResolvedValueOnce(workerBReply);

    // Worker A claims the generation but remains inside the provider call.
    const workerA = generateChatAiReply(input);

    await firstProviderCallStarted;

    // Simulate Worker A's lease expiring while its provider call is pending.
    const expired = await prisma.chatAiGeneration.updateMany({
      where: {
        customerMessageId: message.id,
        status: "PROCESSING",
      },
      data: {
        leaseExpiresAt: new Date(Date.now() - 5_000),
      },
    });

    expect(expired.count).toBe(1);

    // Worker B reclaims the expired lease and completes successfully.
    const workerB = await generateChatAiReply(input);

    expect(workerB.status).toBe("GENERATED");
    expect(workerB.botMessage?.content).toBe(workerBReply.reply);

    // Worker A finally receives its response after losing its lease.
    resolveFirstProviderCall({
      reply: "Worker A stale response must not be persisted.",
      handoff: {
        recommended: false,
        reason: null,
      },
    });

    const staleWorkerResult = await workerA;

    expect(staleWorkerResult.status).toBe("GENERATED");
    expect(staleWorkerResult.botMessage?.id).toBe(workerB.botMessage?.id);
    expect(staleWorkerResult.botMessage?.content).toBe(workerBReply.reply);

    expect(mocks.generateReply).toHaveBeenCalledTimes(2);

    const generation = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(generation).toMatchObject({
      status: "COMPLETED",
      attemptCount: 2,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: null,
    });

    const botMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "BOT",
        clientMessageId: message.id,
      },
    });

    expect(botMessages).toHaveLength(1);
    expect(botMessages[0]?.content).toBe(workerBReply.reply);
  });

  it("does not generate from an unapproved knowledge base", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    mocks.knowledgeBase.status = "Draft — pending approval";
    mocks.knowledgeBase.approved = false;

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("NOT_CONFIGURED");
    expect(mocks.generateReply).not.toHaveBeenCalled();

    const generation = await prisma.chatAiGeneration.findUnique({
      where: { customerMessageId: message.id },
    });

    expect(generation).toBeNull();
  });

  it("rejects an owner who does not own the conversation", async () => {
    const owner = await createCustomerOwner();
    const otherOwner = await createCustomerOwner();

    const { conversation, message } = await createCustomerMessage(owner);

    const result = await generateChatAiReply({
      owner: otherOwner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(mocks.generateReply).not.toHaveBeenCalled();

    const generation = await prisma.chatAiGeneration.findUnique({
      where: { customerMessageId: message.id },
    });

    expect(generation).toBeNull();
  });

  it("does not generate for a guest-owned conversation accessed by another guest", async () => {
    const owner = await createGuestOwner();
    const otherOwner = await createGuestOwner();

    const conversation = await createConversation(owner);
    conversationIds.push(conversation.id);

    const message = await sendCustomerMessage(owner, conversation.id, {
      content: "I need help with a return.",
      clientMessageId: randomUUID(),
    });

    const result = await generateChatAiReply({
      owner: otherOwner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(mocks.generateReply).not.toHaveBeenCalled();
  });

  it("does not generate when the conversation is no longer bot active", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    await requestHumanHandoff(owner, conversation.id);

    const result = await generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    expect(result.status).toBe("SKIPPED");
    expect(mocks.generateReply).not.toHaveBeenCalled();
  });

  it("discards an AI response when handoff wins during generation", async () => {
    const owner = await createCustomerOwner();
    const { conversation, message } = await createCustomerMessage(owner);

    let resolveGeneration!: (value: typeof generatedReply) => void;
    let notifyStarted!: () => void;

    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });

    mocks.generateReply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
          notifyStarted();
        }),
    );

    const pendingGeneration = generateChatAiReply({
      owner,
      conversationId: conversation.id,
      customerMessageId: message.id,
    });

    await started;

    const handedOff = await requestHumanHandoff(owner, conversation.id);

    expect(handedOff.status).toBe("WAITING_FOR_AGENT");

    resolveGeneration(generatedReply);

    const result = await pendingGeneration;

    expect(result.status).toBe("UNAVAILABLE");

    const botMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId: conversation.id,
        senderType: "BOT",
        clientMessageId: message.id,
      },
    });

    expect(botMessages).toHaveLength(0);

    const generation = await prisma.chatAiGeneration.findUniqueOrThrow({
      where: { customerMessageId: message.id },
    });

    expect(generation.status).toBe("FAILED");
    expect(generation.failureCode).toBe("CONVERSATION_NOT_BOT_ACTIVE");
  });
});
