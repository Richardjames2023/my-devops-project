import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatOwnerRequest } from "../src/modules/chat/chat.types";

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  requestHumanHandoff: vi.fn(),
  sendCustomerMessage: vi.fn(),
  generateChatAiReply: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../src/modules/chat/chat.service", () => ({
  createConversation: mocks.createConversation,
  getConversation: mocks.getConversation,
  listConversationMessages: mocks.listConversationMessages,
  listConversations: mocks.listConversations,
  requestHumanHandoff: mocks.requestHumanHandoff,
  sendCustomerMessage: mocks.sendCustomerMessage,
}));

vi.mock("../src/modules/chat/ai/chat-ai.service", () => ({
  generateChatAiReply: mocks.generateChatAiReply,
}));

vi.mock("../src/config/logger", () => ({
  logger: {
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { sendCustomerMessageController } from "../src/modules/chat/chat.controller";

const owner = {
  type: "CUSTOMER" as const,
  id: "11111111-1111-4111-8111-111111111111",
};

const conversationId = "22222222-2222-4222-8222-222222222222";
const clientMessageId = "33333333-3333-4333-8333-333333333333";

const customerMessage = {
  id: "44444444-4444-4444-8444-444444444444",
  conversationId,
  senderType: "CUSTOMER",
  content: "Where is my order?",
  createdAt: new Date("2026-11-19T10:00:00.000Z"),
};

function createRequest(
  body: unknown = {
    content: "Where is my order?",
    clientMessageId,
  },
): ChatOwnerRequest {
  return {
    chatOwner: owner,
    params: { conversationId },
    body,
  } as unknown as ChatOwnerRequest;
}

function createResponse() {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };

  return response;
}

describe("sendCustomerMessageController", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.sendCustomerMessage.mockResolvedValue(customerMessage);

    mocks.generateChatAiReply.mockResolvedValue({
      status: "NOT_CONFIGURED",
    });
  });

  it("accepts the customer message when AI is not configured", async () => {
    const req = createRequest();
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    expect(mocks.sendCustomerMessage).toHaveBeenCalledWith(
      owner,
      conversationId,
      {
        content: "Where is my order?",
        clientMessageId,
      },
    );

    expect(mocks.generateChatAiReply).toHaveBeenCalledWith({
      owner,
      conversationId,
      customerMessageId: customerMessage.id,
    });

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Chat message accepted",
      data: {
        message: customerMessage,
        automation: {
          status: "NOT_CONFIGURED",
        },
      },
    });
  });

  it("returns the generated bot reply with the customer message", async () => {
    const botMessage = {
      id: "55555555-5555-4555-8555-555555555555",
      senderType: "BOT",
      content: "You can track your order from your account.",
      createdAt: new Date("2026-11-19T10:00:01.000Z"),
    };

    mocks.generateChatAiReply.mockResolvedValue({
      status: "GENERATED",
      botMessage,
    });

    const req = createRequest();
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Chat message accepted",
      data: {
        message: customerMessage,
        automation: {
          status: "GENERATED",
          botMessage,
        },
      },
    });
  });

  it("returns a handoff recommendation without changing conversation state", async () => {
    mocks.generateChatAiReply.mockResolvedValue({
      status: "HANDOFF_RECOMMENDED",
      botMessage: {
        id: "55555555-5555-4555-8555-555555555555",
        senderType: "BOT",
        content: "A support agent can help with this request.",
        createdAt: new Date("2026-11-19T10:00:01.000Z"),
      },
    });

    const req = createRequest();
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    const payload = res.json.mock.calls[0]?.[0];

    expect(payload.data.automation.status).toBe(
      "HANDOFF_RECOMMENDED",
    );
    expect(mocks.requestHumanHandoff).not.toHaveBeenCalled();
  });

  it("accepts the customer message when AI generation is unavailable", async () => {
    mocks.generateChatAiReply.mockResolvedValue({
      status: "UNAVAILABLE",
    });

    const req = createRequest();
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Chat message accepted",
      data: {
        message: customerMessage,
        automation: {
          status: "UNAVAILABLE",
        },
      },
    });
  });

  it("reuses the persisted customer message ID when a request is retried", async () => {
    const req = createRequest();
    const firstResponse = createResponse();
    const retryResponse = createResponse();

    await sendCustomerMessageController(
      req,
      firstResponse as unknown as Response,
    );

    await sendCustomerMessageController(
      req,
      retryResponse as unknown as Response,
    );

    expect(mocks.sendCustomerMessage).toHaveBeenCalledTimes(2);
    expect(mocks.generateChatAiReply).toHaveBeenCalledTimes(2);

    expect(mocks.generateChatAiReply).toHaveBeenNthCalledWith(1, {
      owner,
      conversationId,
      customerMessageId: customerMessage.id,
    });

    expect(mocks.generateChatAiReply).toHaveBeenNthCalledWith(2, {
      owner,
      conversationId,
      customerMessageId: customerMessage.id,
    });
  });

  it("preserves message acceptance when AI generation throws unexpectedly", async () => {
    mocks.generateChatAiReply.mockRejectedValue(
      new Error("Unexpected AI persistence failure"),
    );

    const req = createRequest();
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    expect(mocks.sendCustomerMessage).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Chat message accepted",
      data: {
        message: customerMessage,
        automation: {
          status: "UNAVAILABLE",
        },
      },
    });

    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Chat AI generation failed after customer message was accepted",
      undefined,
      {
        conversationId,
        customerMessageId: customerMessage.id,
        errorName: "Error",
      },
    );
  });

  it("rejects invalid customer messages without invoking either service", async () => {
    const req = createRequest({
      content: "",
      clientMessageId,
    });
    const res = createResponse();

    await sendCustomerMessageController(
      req,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.sendCustomerMessage).not.toHaveBeenCalled();
    expect(mocks.generateChatAiReply).not.toHaveBeenCalled();
  });
});
