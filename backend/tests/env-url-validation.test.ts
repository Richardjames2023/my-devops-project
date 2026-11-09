import { describe, expect, it } from "vitest";
import { isHttpsUrl, isSecureProductionEmailUrl } from "../src/config/url-validation";

describe("production email base URL validation", () => {
  it("accepts HTTPS application URLs", () => {
    expect(isHttpsUrl("https://shop.example.com")).toBe(true);
    expect(isHttpsUrl("https://shop.example.com/account")).toBe(true);
  });

  it("rejects HTTP and non-web protocols", () => {
    expect(isHttpsUrl("http://shop.example.com")).toBe(false);
    expect(isHttpsUrl("ftp://shop.example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isHttpsUrl("not-a-url")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });

  it("requires HTTPS only when transactional email is enabled in production", () => {
    expect(isSecureProductionEmailUrl("production", true, "https://shop.example.com")).toBe(true);
    expect(isSecureProductionEmailUrl("production", true, "http://shop.example.com")).toBe(false);
    expect(isSecureProductionEmailUrl("development", true, "http://localhost:3000")).toBe(true);
    expect(isSecureProductionEmailUrl("test", true, "http://localhost:3000")).toBe(true);
    expect(isSecureProductionEmailUrl("production", false, "http://localhost:3000")).toBe(true);
  });
});
