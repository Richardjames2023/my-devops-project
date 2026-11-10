import { Prisma } from "@prisma/client";
import { NIGERIAN_DELIVERY_REGIONS } from "./nigeria-delivery-regions";

export type ConfiguredNigeriaDeliveryFee = {
  region: (typeof NIGERIAN_DELIVERY_REGIONS)[number];
  deliveryFee: Prisma.Decimal;
};

/**
 * Validates and converts every regional fee before the seed performs any writes.
 * An entirely unset configuration remains an intentional opt-out; partial or
 * malformed configuration fails fast.
 */
export function getConfiguredNigeriaDeliveryFees(
  environment: Readonly<Record<string, string | undefined>>,
): ConfiguredNigeriaDeliveryFee[] {
  const configuredFees = NIGERIAN_DELIVERY_REGIONS.map((region) => ({
    region,
    fee: environment[region.feeEnvironmentVariable]?.trim(),
  }));
  const configuredCount = configuredFees.filter(({ fee }) => fee !== undefined && fee !== "").length;

  if (configuredCount === 0) return [];

  if (configuredCount !== NIGERIAN_DELIVERY_REGIONS.length) {
    throw new Error("Configure all six regional DELIVERY_FEE_* values before seeding nationwide delivery zones.");
  }

  return configuredFees.map(({ region, fee }) => {
    if (!fee || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(fee)) {
      throw new Error(
        region.feeEnvironmentVariable +
          " must be a non-negative NGN amount with at most two decimal places.",
      );
    }

    const deliveryFee = new Prisma.Decimal(fee);
    if (deliveryFee.greaterThan("9999999999.99")) {
      throw new Error(region.feeEnvironmentVariable + " exceeds the maximum delivery fee.");
    }

    return { region, deliveryFee };
  });
}
