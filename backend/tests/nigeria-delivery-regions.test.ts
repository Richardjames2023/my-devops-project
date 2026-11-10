import { describe, expect, it } from "vitest";
import { NIGERIAN_DELIVERY_COVERAGE_COUNT, NIGERIAN_DELIVERY_REGIONS } from "../prisma/nigeria-delivery-regions";

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
});
