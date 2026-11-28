import { describe, expect, it } from "vitest";
import { assertTurnstileResponse } from "../src/modules/security/turnstile.service";

describe("Turnstile response validation", () => {
  const validResponse = {
    success: true,
    hostname: "localhost",
    action: "customer_registration",
  };

  it("accepts a successful token for the configured hostname and action", () => {
    expect(() => assertTurnstileResponse(validResponse, ["localhost"])).not.toThrow();
  });

  it("rejects invalid, expired, or already-used tokens", () => {
    expect(() => assertTurnstileResponse({
      ...validResponse,
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    }, ["localhost"])).toThrow("security check");
  });

  it("rejects a token issued for an unexpected hostname", () => {
    expect(() => assertTurnstileResponse({
      ...validResponse,
      hostname: "attacker.example",
    }, ["localhost"])).toThrow("security check");
  });

  it("rejects a token issued for a different action", () => {
    expect(() => assertTurnstileResponse({
      ...validResponse,
      action: "login",
    }, ["localhost"])).toThrow("security check");
  });

  it("requires a hostname when an allowlist is configured", () => {
    expect(() => assertTurnstileResponse({
      success: true,
      action: "customer_registration",
    }, ["localhost"])).toThrow("security check");
  });

  it("accepts any returned hostname only when no hostname allowlist is configured", () => {
    expect(() => assertTurnstileResponse({
      ...validResponse,
      hostname: "127.0.0.1",
    })).not.toThrow();
  });
});
