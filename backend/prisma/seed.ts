import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getConfiguredNigeriaDeliveryFees } from "./nigeria-delivery-fees";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

const permissions = [
  "users.read",
  "users.manage",
  "staff.read",
  "staff.manage",
  "products.read",
  "products.manage",
  "categories.read",
  "categories.manage",
  "inventory.read",
  "inventory.manage",
  "orders.create",
  "orders.read",
  "orders.manage",
  "coupons.manage",
  "payments.read",
  "payments.manage",
  "fulfillment.read",
  "fulfillment.manage",
  "deliveries.read",
  "deliveries.manage",
  "delivery_zones.manage",
  "returns.read",
  "returns.manage",
  "refunds.read",
  "refunds.manage",
  "warranty.read",
  "warranty.manage",
  "reports.read",
  "settings.read",
  "settings.manage",
  "audit_logs.read",
];

const roles = {
  CUSTOMER: [
    "products.read",
    "categories.read",
    "orders.create",
    "orders.read",
    "returns.read",
    "warranty.read",
  ],
  BUSINESS_OWNER: permissions,
  INVENTORY_MANAGER: [
    "products.read",
    "categories.read",
    "inventory.read",
    "inventory.manage",
    "orders.read",
  ],
  ORDER_OPERATOR: [
    "products.read",
    "categories.read",
    "orders.read",
    "orders.manage",
    "payments.read",
    "fulfillment.read",
    "fulfillment.manage",
  ],
  SUPPORT_STAFF: [
    "users.read",
    "products.read",
    "orders.read",
    "returns.read",
    "returns.manage",
    "refunds.read",
    "warranty.read",
    "warranty.manage",
  ],
  DELIVERY_AGENT: [
    "orders.read",
    "fulfillment.read",
    "deliveries.read",
    "deliveries.manage",
  ],
} as const;

async function seedNationwideDeliveryZones(
  configuredFees: ReturnType<typeof getConfiguredNigeriaDeliveryFees>,
): Promise<void> {
  if (configuredFees.length === 0) {
    console.log("Nationwide delivery zones skipped: configure all six regional DELIVERY_FEE_* values to seed them.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const { region, deliveryFee } of configuredFees) {
      const zone = await tx.deliveryZone.upsert({
        where: { name: region.name },
        update: { deliveryFee, isActive: true },
        create: { name: region.name, deliveryFee },
      });

      for (const state of region.states) {
        await tx.deliveryZoneLocation.upsert({
          where: { state_city: { state, city: "*" } },
          update: { zoneId: zone.id },
          create: { zoneId: zone.id, state, city: "*" },
        });
      }
    }
  }, { timeout: 30_000 });

  for (const { region } of configuredFees) {
    console.log("Seeded " + region.name + " (" + region.states.length + " states/territory).");
  }
}

async function main(): Promise<void> {
  // Validate all regional fees before any seed writes begin.
  const configuredDeliveryFees = getConfiguredNigeriaDeliveryFees(process.env);

  console.log("Seeding permissions...");
  const permissionRecords = new Map<string, string>();

  for (const permissionName of permissions) {
    const permission = await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: { name: permissionName },
    });
    permissionRecords.set(permissionName, permission.id);
  }

  console.log("Permissions seeded.");
  console.log("Seeding roles...");

  for (const [roleName, rolePermissions] of Object.entries(roles)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionName of rolePermissions) {
      const permissionId = permissionRecords.get(permissionName);
      if (!permissionId) {
        throw new Error(`Permission "${permissionName}" was not found.`);
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId,
        },
      });
    }
  }

  console.log("Roles seeded.");
  await seedNationwideDeliveryZones(configuredDeliveryFees);
  console.log("Roles and permissions seeded. Run the explicit staff bootstrap command to create the initial owner.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
