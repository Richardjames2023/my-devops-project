import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { createAuditLog } from "../../common/utils/audit-log";
import type {
  CreateDeliveryZoneInput,
  UpdateDeliveryZoneInput,
} from "./delivery-zone.validation";
import { normalizeDeliveryCity, normalizeDeliveryState } from "./delivery-zone.normalization";

function normalizeDeliveryLocations(
  locations: Array<{ state: string; city: string }>,
) {
  return locations.map(({ state, city }) => ({
    state: normalizeDeliveryState(state),
    city: city === "*" ? "*" : normalizeDeliveryCity(city),
  }));
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapUniqueConflict(error: unknown): never {
  if (isUniqueConflict(error)) {
    throw new AppError("A delivery zone with this name or one of these locations already exists", 409);
  }
  throw error;
}

export async function listActiveDeliveryZones() {
  return prisma.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      deliveryFee: true,
      locations: { select: { state: true, city: true }, orderBy: [{ state: "asc" }, { city: "asc" }] },
    },
  });
}

export type DeliveryZoneLookupClient = Pick<Prisma.TransactionClient, "deliveryZone">;

/** Exact city pricing takes precedence over the state's "*" fallback. */
export async function findDeliveryZoneForLocation(
  client: DeliveryZoneLookupClient,
  state: string,
  city: string,
) {
  const normalizedState = normalizeDeliveryState(state);
  const normalizedCity = normalizeDeliveryCity(city);
  const select = { id: true, name: true, deliveryFee: true } as const;

  const exactCityZone = await client.deliveryZone.findFirst({
    where: {
      isActive: true,
      locations: { some: { state: normalizedState, city: normalizedCity } },
    },
    select,
  });
  if (exactCityZone) return exactCityZone;

  return client.deliveryZone.findFirst({
    where: {
      isActive: true,
      locations: { some: { state: normalizedState, city: "*" } },
    },
    select,
  });
}

export async function quoteDeliveryFee(state: string, city: string) {
  const zone = await findDeliveryZoneForLocation(prisma, state, city);
  if (!zone) {
    throw new AppError(`We do not currently deliver to ${city.trim()}, ${state.trim()}`, 422);
  }
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    deliveryFee: zone.deliveryFee,
    currency: "NGN",
  };
}

export async function listDeliveryZones() {
  return prisma.deliveryZone.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      locations: { orderBy: [{ state: "asc" }, { city: "asc" }] },
    },
  });
}

export async function createDeliveryZone(
  actorStaffId: string,
  input: CreateDeliveryZoneInput,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.create({
        data: {
          name: input.name.trim(),
          deliveryFee: new Prisma.Decimal(input.deliveryFee),
          locations: { create: normalizeDeliveryLocations(input.locations) },
        },
        include: { locations: true },
      });

      await createAuditLog(tx, {
        staffAccountId: actorStaffId,
        action: "DELIVERY_ZONE_CREATED",
        entity: "DeliveryZone",
        entityId: zone.id,
        newValues: {
          name: zone.name,
          deliveryFee: zone.deliveryFee.toString(),
          locations: zone.locations.map(({ state, city }) => ({ state, city })),
        },
        ...metadata,
      });
      return zone;
    });
  } catch (error) {
    mapUniqueConflict(error);
  }
}

export async function updateDeliveryZone(
  actorStaffId: string,
  zoneId: string,
  input: UpdateDeliveryZoneInput,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryZone.findUnique({
        where: { id: zoneId },
        include: { locations: true },
      });
      if (!existing) throw new AppError("Delivery zone not found", 404);

      const zone = await tx.deliveryZone.update({
        where: { id: zoneId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.deliveryFee !== undefined ? { deliveryFee: new Prisma.Decimal(input.deliveryFee) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.locations !== undefined
            ? {
                locations: {
                  deleteMany: {},
                  create: normalizeDeliveryLocations(input.locations),
                },
              }
            : {}),
        },
        include: { locations: true },
      });

      await createAuditLog(tx, {
        staffAccountId: actorStaffId,
        action: "DELIVERY_ZONE_UPDATED",
        entity: "DeliveryZone",
        entityId: zone.id,
        oldValues: {
          name: existing.name,
          deliveryFee: existing.deliveryFee.toString(),
          isActive: existing.isActive,
          locations: existing.locations.map(({ state, city }) => ({ state, city })),
        },
        newValues: {
          name: zone.name,
          deliveryFee: zone.deliveryFee.toString(),
          isActive: zone.isActive,
          locations: zone.locations.map(({ state, city }) => ({ state, city })),
        },
        ...metadata,
      });
      return zone;
    });
  } catch (error) {
    mapUniqueConflict(error);
  }
}
