import { describe, expect, it } from "vitest";
import { createCouponSchema, updateCouponSchema } from "../src/modules/coupons/coupon.validation";

describe("coupon validation", () => {
  it("normalizes coupon codes to uppercase", () => {
    const result = createCouponSchema.parse({
      code: "welcome10",
      discountType: "PERCENTAGE",
      discountValue: "10",
    });
    expect(result.code).toBe("WELCOME10");
  });

  it("rejects percentage discounts greater than 100", () => {
    const result = createCouponSchema.safeParse({
      code: "TOOMUCH",
      discountType: "PERCENTAGE",
      discountValue: "100.01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero and negative fixed discounts", () => {
    for (const discountValue of ["0", "-5"]) {
      expect(createCouponSchema.safeParse({
        code: "FIXEDZERO",
        discountType: "FIXED_AMOUNT",
        discountValue,
      }).success).toBe(false);
    }
  });

  it("rejects expiry dates that are not later than the start date", () => {
    const result = createCouponSchema.safeParse({
      code: "DATED",
      discountType: "FIXED_AMOUNT",
      discountValue: "500",
      startsAt: "2026-11-10T12:00:00.000Z",
      expiresAt: "2026-11-10T11:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("supports partial updates without requiring creation fields", () => {
    expect(updateCouponSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });

  it("normalizes a coupon code supplied during an update", () => {
    expect(updateCouponSchema.parse({ code: "blackfriday" }).code).toBe("BLACKFRIDAY");
  });
});
