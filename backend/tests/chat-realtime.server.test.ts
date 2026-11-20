import { describe, expect, it } from "vitest";
import { isChatOriginAllowed } from "../src/modules/chat/chat-realtime.server";

describe("chat realtime origin policy", () => {
  const allowedOrigins = [
    "http://localhost:3000",
    "https://store.example.com",
  ];

  it("allows configured browser origins", () => {
    expect(isChatOriginAllowed("http://localhost:3000", allowedOrigins)).toBe(true);
    expect(isChatOriginAllowed("https://store.example.com", allowedOrigins)).toBe(true);
  });

  it("rejects browser origins that are not explicitly configured", () => {
    expect(isChatOriginAllowed("https://attacker.example", allowedOrigins)).toBe(false);
    expect(isChatOriginAllowed("null", allowedOrigins)).toBe(false);
  });

  it("allows requests without an Origin header for native and server clients", () => {
    expect(isChatOriginAllowed(undefined, allowedOrigins)).toBe(true);
  });
});
