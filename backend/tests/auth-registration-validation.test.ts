import { describe, expect, it } from "vitest";
import { registerSchema } from "../src/modules/auth/auth.validation";

const validRegistration = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ADA@example.com",
  password: "correct-horse-battery",
};

describe("customer registration validation", () => {
  it("accepts valid registration details and normalizes the email", () => {
    const result = registerSchema.safeParse(validRegistration);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada@example.com");
    }
  });

  it("requires a password of at least 12 characters", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: "short-pass",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a 12-character password", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: "123456789012",
    });

    expect(result.success).toBe(true);
  });

  it("rejects passwords longer than 128 characters", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: "a".repeat(129),
    });

    expect(result.success).toBe(false);
  });

  it("accepts a 128-character password", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: "a".repeat(128),
    });

    expect(result.success).toBe(true);
  });

  it("keeps the phone number optional", () => {
    const result = registerSchema.safeParse(validRegistration);

    expect(result.success).toBe(true);
  });

  it("validates a supplied phone number", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      phone: "08012345678",
    });

    expect(result.success).toBe(true);
  });
});
