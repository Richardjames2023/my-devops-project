import { describe, expect, it } from "vitest";
import {
  createDeliveryZoneSchema,
  updateDeliveryZoneSchema,
} from "../src/modules/delivery-zones/delivery-zone.validation";

const validCreateInput = {
  name: "Abuja Metro",
  deliveryFee: 350,
  locations: [{ state: "FCT", city: "Wuse" }],
};

describe("delivery zone fee validation", () => {
  it.each([0, 350, 350.5, 350.25, 0.01, 9999999999.99])(
    "accepts a delivery fee with at most two decimal places: %s",
    (deliveryFee) => {
      expect(
        createDeliveryZoneSchema.safeParse({
          ...validCreateInput,
          deliveryFee,
        }).success,
      ).toBe(true);

      expect(
        updateDeliveryZoneSchema.safeParse({ deliveryFee }).success,
      ).toBe(true);
    },
  );

  it.each([350.005, 350.123, 0.001, 1e-7])(
    "rejects a delivery fee with more than two decimal places: %s",
    (deliveryFee) => {
      const createResult = createDeliveryZoneSchema.safeParse({
        ...validCreateInput,
        deliveryFee,
      });
      const updateResult = updateDeliveryZoneSchema.safeParse({ deliveryFee });

      expect(createResult.success).toBe(false);
      expect(updateResult.success).toBe(false);

      if (!createResult.success) {
        expect(createResult.error.issues[0]?.message).toBe(
          "Delivery fee must have no more than two decimal places",
        );
      }

      if (!updateResult.success) {
        expect(updateResult.error.issues[0]?.message).toBe(
          "Delivery fee must have no more than two decimal places",
        );
      }
    },
  );

  it("normalizes Abuja aliases to the canonical FCT state", () => {
    const result = createDeliveryZoneSchema.safeParse({
      ...validCreateInput,
      locations: [{ state: "Federal Capital Territory", city: "Central Area" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locations[0]).toEqual({ state: "FCT", city: "CENTRAL AREA" });
    }
  });

  it("accepts only the complete wildcard city sentinel", () => {
    expect(createDeliveryZoneSchema.safeParse({ ...validCreateInput, locations: [{ state: "LAGOS", city: "*" }] }).success).toBe(true);
    expect(createDeliveryZoneSchema.safeParse({ ...validCreateInput, locations: [{ state: "LAGOS", city: "IKE*JA" }] }).success).toBe(false);
  });

  it("continues to reject negative and out-of-range delivery fees", () => {
    expect(
      createDeliveryZoneSchema.safeParse({
        ...validCreateInput,
        deliveryFee: -0.01,
      }).success,
    ).toBe(false);

    expect(
      updateDeliveryZoneSchema.safeParse({ deliveryFee: 10000000000 }).success,
    ).toBe(false);
  });
});
