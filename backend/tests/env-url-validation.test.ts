import { describe, expect, it } from "vitest";
import { isHttpsUrl } from "../src/config/url-validation";

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
});
