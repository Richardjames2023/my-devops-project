import { describe, expect, it } from "vitest";
import { NIGERIAN_DELIVERY_COVERAGE_COUNT, NIGERIAN_DELIVERY_REGIONS } from "../prisma/nigeria-delivery-regions";
import { getConfiguredNigeriaDeliveryFees } from "../prisma/nigeria-delivery-fees";

describe("Nigerian geopolitical delivery regions", () => {
  it("covers all 36 states and the FCT exactly once", () => {
    const states = NIGERIAN_DELIVERY_REGIONS.flatMap((region) => region.states);
    expect(NIGERIAN_DELIVERY_COVERAGE_COUNT).toBe(37);
    expect(new Set(states).size).toBe(37);
    expect(states).toContain("FCT");
  });

  it("defines six independently priced geopolitical regions", () => {
    expect(NIGERIAN_DELIVERY_REGIONS).toHaveLength(6);
    expect(new Set(NIGERIAN_DELIVERY_REGIONS.map((region) => region.feeEnvironmentVariable)).size).toBe(6);
  });

  
  it("validates every regional fee before returning any seedable records", () => {
    const environment = Object.fromEntries(
      NIGERIAN_DELIVERY_REGIONS.map((region, index) => [
        region.feeEnvironmentVariable,
        index === NIGERIAN_DELIVERY_REGIONS.length - 1 ? "not-a-fee" : "1500.25",
      ]),
    );

    expect(() => getConfiguredNigeriaDeliveryFees(environment)).toThrow(
      "DELIVERY_FEE_SOUTH_WEST must be a non-negative NGN amount with at most two decimal places.",
    );
  });

  it("rejects partial regional fee configuration and permits all fees to be omitted", () => {
    expect(getConfiguredNigeriaDeliveryFees({})).toEqual([]);
    expect(() =>
      getConfiguredNigeriaDeliveryFees({
        [NIGERIAN_DELIVERY_REGIONS[0].feeEnvironmentVariable]: "1000",
      }),
    ).toThrow("Configure all six regional DELIVERY_FEE_* values");
  });

  it("converts all six valid regional fees to exact decimal values", () => {
    const environment = Object.fromEntries(
      NIGERIAN_DELIVERY_REGIONS.map((region) => [region.feeEnvironmentVariable, "1250.50"]),
    );
    const configuredFees = getConfiguredNigeriaDeliveryFees(environment);

    expect(configuredFees).toHaveLength(6);
    expect(configuredFees.every(({ deliveryFee }) => deliveryFee.toString() === "1250.5")).toBe(true);
  });
});
