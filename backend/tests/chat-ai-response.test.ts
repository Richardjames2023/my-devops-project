
import { describe, expect, it } from "vitest";
import { parseChatAiResponse } from "../src/modules/chat/ai/chat-ai.response";

describe("Chat AI response validation", () => {
  it("accepts a valid customer-support response", () => {
    const result = parseChatAiResponse(
      JSON.stringify({
        reply: "I can help you check your order.",
        handoff: {
          recommended: false,
          reason: null,
        },
      }),
    );

    expect(result).toEqual({
      reply: "I can help you check your order.",
      handoff: {
        recommended: false,
        reason: null,
      },
    });
  });

  it("accepts a valid human-handoff recommendation", () => {
    const result = parseChatAiResponse(
      JSON.stringify({
        reply: "I'll connect you with our customer-care team.",
        handoff: {
          recommended: true,
          reason: "The customer requested human assistance.",
        },
      }),
    );

    expect(result.handoff.recommended).toBe(true);
    expect(result.handoff.reason).toBe(
      "The customer requested human assistance.",
    );
  });

  it("rejects an empty response", () => {
    expect(() => parseChatAiResponse(undefined)).toThrow(
      "AI provider returned an empty response",
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseChatAiResponse("not valid JSON")).toThrow(
      "AI provider returned invalid JSON",
    );
  });

  it("rejects a missing handoff object", () => {
    expect(() =>
      parseChatAiResponse(
        JSON.stringify({
          reply: "How can I help?",
        }),
      ),
    ).toThrow();
  });

  it("rejects unexpected response properties", () => {
    expect(() =>
      parseChatAiResponse(
        JSON.stringify({
          reply: "How can I help?",
          handoff: {
            recommended: false,
            reason: null,
          },
          executeRefund: true,
        }),
      ),
    ).toThrow();
  });

  it("rejects an empty reply", () => {
    expect(() =>
      parseChatAiResponse(
        JSON.stringify({
          reply: " ",
          handoff: {
            recommended: false,
            reason: null,
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects a handoff reason longer than 500 characters", () => {
    expect(() =>
      parseChatAiResponse(
        JSON.stringify({
          reply: "I will connect you with support.",
          handoff: {
            recommended: true,
            reason: "a".repeat(501),
          },
        }),
      ),
    ).toThrow();
  });
});
