import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, runWithRequestContext } from "../src/config/logger";

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes JSON logs with level, timestamp, service and request ID", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    runWithRequestContext("req-test-123", () => logger.info("request completed", { statusCode: 200 }));
    const entry = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      service: "my-devops-project-api",
      requestId: "req-test-123",
      message: "request completed",
      statusCode: 200,
    });
    expect(typeof entry.timestamp).toBe("string");
  });

  it("does not allow caller context to overwrite reserved metadata", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.info("trusted message", {
      level: "error",
      message: "forged message",
      service: "attacker-service",
      timestamp: "not-a-date",
      requestId: "forged-request",
    });
    const entry = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "info", message: "trusted message", service: "my-devops-project-api" });
    expect(entry.timestamp).not.toBe("not-a-date");
    expect(entry.requestId).not.toBe("forged-request");
  });

  it("redacts nested secret fields and sensitive URL query parameters", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.warn("credential check", {
      nested: [{ password: "do-not-log", invitationToken: "raw-token-value" }],
      url: "https://example.test/callback?code=secret-code&state=safe",
      authorization: "Bearer abc.def.ghi",
      note: "Authorization: Bearer abc.def.ghi",
    });
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).not.toContain("do-not-log");
    expect(line).not.toContain("raw-token-value");
    expect(line).not.toContain("secret-code");
    expect(line).not.toContain("abc.def.ghi");
    expect(line).toContain("state=safe");
    expect(line).toContain("[REDACTED]");
  });

  it("omits exception messages and stacks but preserves safe diagnostic codes", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const error = Object.assign(new Error("customer@example.com secret-token"), { code: "P2002" });
    logger.error("Database operation failed", error);
    const line = String(write.mock.calls[0]?.[0]);
    const entry = JSON.parse(line) as { error?: { name?: string; code?: string; message?: string; stack?: string } };
    expect(entry.error).toEqual({ name: "Error", code: "P2002" });
    expect(line).not.toContain("customer@example.com");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain(" at ");
  });

  it("handles circular references", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const circular: Record<string, unknown> = { value: "safe" };
    circular.self = circular;
    logger.info("circular context", { circular });
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).toContain("[Circular]");
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("does not throw when context serialization fails", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("blocked"); } });
    expect(() => logger.info("safe fallback", { proxy })).not.toThrow();
    expect(String(write.mock.calls[0]?.[0])).toContain("Log entry could not be serialized");
  });
});
