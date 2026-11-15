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

  it("redacts secret-like fields and bearer credentials", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logger.warn("credential check", {
      password: "do-not-log",
      authorization: "Bearer abc.def.ghi",
      invitationToken: "raw-token-value",
      note: "Authorization: Bearer abc.def.ghi",
    });
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).not.toContain("do-not-log");
    expect(line).not.toContain("raw-token-value");
    expect(line).not.toContain("abc.def.ghi");
    expect(line).toContain("[REDACTED]");
  });
});
