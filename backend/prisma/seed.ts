// import { PrismaClient } from "@prisma/client";
// import { PrismaPg } from "@prisma/adapter-pg";
// import "dotenv/config";
// 
// const adapter = new PrismaPg({
//   connectionString: process.env.DATABASE_URL!,
// });

// const prisma = new PrismaClient({
//   adapter,
// });


// const permissions = [
//   "users.read",
//   "users.manage",
//   "staff.read",
//   "staff.manage",

//   "products.read",
//   "products.manage",

//   "categories.read",
//   "categories.manage",

//   "inventory.read",
//   "inventory.manage",

//   "orders.read",
//   "orders.manage",

//   "payments.read",
//   "payments.manage",

//   "fulfillment.read",
//   "fulfillment.manage",

//   "deliveries.read",
//   "deliveries.manage",

//   "returns.read",
//   "returns.manage",

//   "refunds.read",
//   "refunds.manage",

//   "warranty.read",
//   "warranty.manage",

//   "reports.read",

//   "settings.read",
//   "settings.manage",

//   "audit_logs.read",
// ];

// const roles = {
//   CUSTOMER: [
//     "products.read",
//     "categories.read",
//     "orders.read",
//     "returns.read",
//     "warranty.read",
//   ],

//   BUSINESS_OWNER: permissions,

//   INVENTORY_MANAGER: [
//     "products.read",
//     "categories.read",
//     "inventory.read",
//     "inventory.manage",
//     "orders.read",
//   ],

//   ORDER_OPERATOR: [
//     "products.read",
//     "categories.read",
//     "orders.read",
//     "orders.manage",
//     "payments.read",
//     "fulfillment.read",
//     "fulfillment.manage",
//   ],

//   SUPPORT_STAFF: [
//     "users.read",
//     "products.read",
//     "orders.read",
//     "returns.read",
//     "returns.manage",
//     "refunds.read",
//     "warranty.read",
//     "warranty.manage",
//   ],

//   DELIVERY_AGENT: [
//     "orders.read",
//     "fulfillment.read",
//     "deliveries.read",
//     "deliveries.manage",
//   ],
// } as const;


async function seedNationwideDeliveryZones(): Promise<void> {
  const configuredFees = NIGERIAN_DELIVERY_REGIONS.map((region) => ({
    region,
    fee: process.env[region.feeEnvironmentVariable]?.trim(),
  }));
  const configuredCount = configuredFees.filter(({ fee }) => fee).length;
  if (configuredCount === 0) {
    console.log("Nationwide delivery zones skipped: configure all six regional DELIVERY_FEE_* values to seed them.");
    return;
  }
  if (configuredCount !== NIGERIAN_DELIVERY_REGIONS.length) {
    throw new Error("Configure all six regional DELIVERY_FEE_* values before seeding nationwide delivery zones.");
  }
  for (const { region, fee } of configuredFees) {
    if (!fee || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(fee)) {
      throw new Error(region.feeEnvironmentVariable + " must be a non-negative NGN amount with at most two decimal places.");
    }
    const decimalFee = new Prisma.Decimal(fee);
    if (decimalFee.greaterThan("9999999999.99")) {
      throw new Error(region.feeEnvironmentVariable + " exceeds the maximum delivery fee.");
    }
    const zone = await prisma.deliveryZone.upsert({
      where: { name: region.name },
      update: { deliveryFee: decimalFee, isActive: true },
      create: { name: region.name, deliveryFee: decimalFee },
    });
    for (const state of region.states) {
      await prisma.deliveryZoneLocation.upsert({
        where: { state_city: { state, city: "*" } },
        update: { zoneId: zone.id },
        create: { zoneId: zone.id, state, city: "*" },
      });
    }
    console.log("Seeded " + region.name + " (" + region.states.length + " states/territory).");
  }
}
async function main(): Promise<void> {
//   console.log("Seeding permissions...");

//   const permissionRecords = new Map<string, string>();

//   for (const permissionName of permissions) {
//     const permission = await prisma.permission.upsert({
//       where: {
//         name: permissionName,
//       },
//       update: {},
//       create: {
//         name: permissionName,
//       },
//     });

//     permissionRecords.set(permissionName, permission.id);
//   }

//   console.log("Permissions seeded.");

//   console.log("Seeding roles...");

//   for (const [roleName, rolePermissions] of Object.entries(roles)) {
//     const role = await prisma.role.upsert({
//       where: {
//         name: roleName,
//       },
//       update: {},
//       create: {
//         name: roleName,
//       },
//     });

//     for (const permissionName of rolePermissions) {
//       const permissionId = permissionRecords.get(permissionName);

//       if (!permissionId) {
//         throw new Error(
//           `Permission "${permissionName}" was not found.`,
//         );
//       }

//       await prisma.rolePermission.upsert({
//         where: {
//           roleId_permissionId: {
//             roleId: role.id,
//             permissionId,
//           },
//         },
//         update: {},
//         create: {
//           roleId: role.id,
//           permissionId,
//         },
//       });
//     }
//   }

//   console.log("Roles seeded.");
// }

// main()
//   .catch((error) => {
//     console.error("Seed failed:", error);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { NIGERIAN_DELIVERY_REGIONS } from "./nigeria-delivery-regions";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

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

async function main(): Promise<void> {
  console.log("Seeding permissions...");

  const permissionRecords = new Map<string, string>();

  for (const permissionName of permissions) {
    const permission = await prisma.permission.upsert({
      where: {
        name: permissionName,
      },
      update: {},
      create: {
        name: permissionName,
      },
    });

    permissionRecords.set(permissionName, permission.id);
  }

  console.log("Permissions seeded.");

  console.log("Seeding roles...");

  for (const [roleName, rolePermissions] of Object.entries(roles)) {
    const role = await prisma.role.upsert({
      where: {
        name: roleName,
      },
      update: {},
      create: {
        name: roleName,
      },
    });

    for (const permissionName of rolePermissions) {
      const permissionId = permissionRecords.get(permissionName);

      if (!permissionId) {
        throw new Error(
          `Permission "${permissionName}" was not found.`,
        );
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

  await seedNationwideDeliveryZones();

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