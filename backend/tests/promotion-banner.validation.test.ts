import { describe, expect, it } from "vitest";
import {
  createBannerSchema,
  targetUrlSchema,
  updateBannerSchema,
} from "../src/modules/promotions/promotion-banner.validation";

const valid = {
  title: "November campaign",
  position: "HERO",
  startAt: "2026-11-20T00:00:00.000Z",
  endAt: "2026-11-30T23:59:59.000Z",
};

describe("promotion banner validation", () => {
  it("accepts a valid scheduled banner", () => {
    expect(createBannerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an end date that is not after the start date", () => {
    const result = createBannerSchema.safeParse({
      ...valid,
      endAt: valid.startAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported display positions", () => {
    expect(createBannerSchema.safeParse({ ...valid, position: "SIDEBAR" }).success).toBe(false);
  });

  it("rejects non-HTTPS external destinations", () => {
    expect(createBannerSchema.safeParse({ ...valid, targetUrl: "http://example.com" }).success).toBe(false);
  });

    it("rejects protocol-relative external destinations", () => {
    expect(targetUrlSchema.safeParse("//example.com").success).toBe(false);
  });

  it("rejects backslash-based URL destinations", () => {
    expect(targetUrlSchema.safeParse("/\\example.com").success).toBe(false);
  });

  it("accepts valid HTTPS destinations", () => {
    expect(targetUrlSchema.safeParse("https://example.com/sale").success).toBe(true);
  });

  it("allows relative storefront destinations", () => {
    expect(createBannerSchema.safeParse({ ...valid, targetUrl: "/collections/sale" }).success).toBe(true);
  });

  it("requires at least one field when updating", () => {
    expect(updateBannerSchema.safeParse({}).success).toBe(false);
  });

  it("allows changing publication state independently", () => {
    expect(updateBannerSchema.safeParse({ status: "PAUSED" }).success).toBe(true);
  });
});
