import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = `
  import { env } from "./src/config/env.ts";

  console.log(JSON.stringify({
    enabled: env.CHAT_AI_ENABLED,
    knowledgeBaseApproved: env.CHAT_AI_KNOWLEDGE_BASE_APPROVED,
    provider: env.CHAT_AI_PROVIDER,
    timeout: env.CHAT_AI_TIMEOUT_MS,
    maxHistory: env.CHAT_AI_MAX_HISTORY_MESSAGES,
    maxOutputTokens: env.CHAT_AI_MAX_OUTPUT_TOKENS,
  }));
`;

function runEnvironment(overrides: Record<string, string> = {}) {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    DATABASE_URL:
      "postgresql://test:test@127.0.0.1:5432/shop_db_test",
    CORS_ORIGIN: "http://localhost:3000",
    JWT_ACCESS_SECRET: "test-secret-at-least-32-characters-long",
    DOTENV_CONFIG_PATH: "/dev/null",
    ...overrides,
  };

  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

describe("Chat AI environment configuration", () => {
  it("defaults AI and knowledge-base approval to disabled", () => {
    const result = runEnvironment();

    expect(result.status, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      enabled: false,
      knowledgeBaseApproved: false,
      provider: "gemini",
      timeout: 15_000,
      maxHistory: 12,
      maxOutputTokens: 512,
    });
  });

  it("accepts enabled AI with a Gemini API key", () => {
    const result = runEnvironment({
      CHAT_AI_ENABLED: "true",
      CHAT_AI_KNOWLEDGE_BASE_APPROVED: "true",
      GEMINI_API_KEY: "test-gemini-api-key",
    });

    expect(result.status, result.stderr).toBe(0);

    expect(JSON.parse(result.stdout)).toMatchObject({
      enabled: true,
      knowledgeBaseApproved: true,
      provider: "gemini",
    });
  });

  it("rejects enabled AI without a Gemini API key", () => {
    const result = runEnvironment({
      CHAT_AI_ENABLED: "true",
      GEMINI_API_KEY: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment configuration");
    expect(result.stderr).toContain("GEMINI_API_KEY");
  });

  it("rejects unsupported AI providers", () => {
    const result = runEnvironment({
      CHAT_AI_PROVIDER: "openai",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment configuration");
  });

  it("rejects a timeout outside the permitted range", () => {
    const result = runEnvironment({
      CHAT_AI_TIMEOUT_MS: "999",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment configuration");
  });

  it("rejects history limits above the configured maximum", () => {
    const result = runEnvironment({
      CHAT_AI_MAX_HISTORY_MESSAGES: "31",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment configuration");
  });

  it("rejects output-token limits above the configured maximum", () => {
    const result = runEnvironment({
      CHAT_AI_MAX_OUTPUT_TOKENS: "2049",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment configuration");
  });
});
