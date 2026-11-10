/**
 * Nigeria's six geopolitical delivery regions.
 * The FCT is grouped with North Central, giving 37 covered areas.
 */
export const NIGERIAN_DELIVERY_REGIONS = [
  { name: "North Central", feeEnvironmentVariable: "DELIVERY_FEE_NORTH_CENTRAL", states: ["BENUE", "FCT", "KOGI", "KWARA", "NASARAWA", "NIGER", "PLATEAU"] },
  { name: "North East", feeEnvironmentVariable: "DELIVERY_FEE_NORTH_EAST", states: ["ADAMAWA", "BAUCHI", "BORNO", "GOMBE", "TARABA", "YOBE"] },
  { name: "North West", feeEnvironmentVariable: "DELIVERY_FEE_NORTH_WEST", states: ["JIGAWA", "KADUNA", "KANO", "KATSINA", "KEBBI", "SOKOTO", "ZAMFARA"] },
  { name: "South East", feeEnvironmentVariable: "DELIVERY_FEE_SOUTH_EAST", states: ["ABIA", "ANAMBRA", "EBONYI", "ENUGU", "IMO"] },
  { name: "South South", feeEnvironmentVariable: "DELIVERY_FEE_SOUTH_SOUTH", states: ["AKWA IBOM", "BAYELSA", "CROSS RIVER", "DELTA", "EDO", "RIVERS"] },
  { name: "South West", feeEnvironmentVariable: "DELIVERY_FEE_SOUTH_WEST", states: ["EKITI", "LAGOS", "OGUN", "ONDO", "OSUN", "OYO"] },
] as const;

export const NIGERIAN_DELIVERY_COVERAGE_COUNT =
  NIGERIAN_DELIVERY_REGIONS.reduce((total, region) => total + region.states.length, 0);
