import { describe, expect, it } from "vitest";
import { facebookAccessTokenSchema, googleCredentialSchema } from "../src/modules/auth/social-auth.validation";

describe("social authentication credential validation", () => {
  it("accepts a Google ID token-shaped credential", () => {
    expect(googleCredentialSchema.safeParse({ credential: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects missing, short, and oversized Google credentials", () => {
    expect(googleCredentialSchema.safeParse({}).success).toBe(false);
    expect(googleCredentialSchema.safeParse({ credential: "short" }).success).toBe(false);
    expect(googleCredentialSchema.safeParse({ credential: "a".repeat(10_001) }).success).toBe(false);
  });

  it("accepts a Facebook access-token-shaped credential", () => {
    expect(facebookAccessTokenSchema.safeParse({ accessToken: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects missing, short, and oversized Facebook credentials", () => {
    expect(facebookAccessTokenSchema.safeParse({}).success).toBe(false);
    expect(facebookAccessTokenSchema.safeParse({ accessToken: "short" }).success).toBe(false);
    expect(facebookAccessTokenSchema.safeParse({ accessToken: "a".repeat(10_001) }).success).toBe(false);
  });
});
