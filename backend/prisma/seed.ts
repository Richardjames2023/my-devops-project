// import { PrismaClient } from "@prisma/client";
// import { PrismaPg } from "@prisma/adapter-pg";
// import "dotenv/config";
// import argon2 from "argon2";

// const adapter = new PrismaPg({
//   connectionString: process.env.DATABASE_URL!,
// });

// const prisma = new PrismaClient({
//   adapter,
// });


// const permissions = [
//   "users.read",
//   "users.manage",

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


// async function main(): Promise<void> {
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

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import argon2 from "argon2";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

const permissions = [
  "users.read",
  "users.manage",

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

  // --------------------------------------------------
  // Seed development BUSINESS_OWNER account
  // --------------------------------------------------

  console.log("Seeding business owner...");

  const passwordHash = await argon2.hash(
    "BusinessOwner123!",
  );

  const businessOwner = await prisma.user.upsert({
    where: {
      email: "business.owner@example.com",
    },
    update: {},
    create: {
      email: "business.owner@example.com",
      passwordHash,
      firstName: "Business",
      lastName: "Owner",
      isActive: true,
    },
  });

  const businessOwnerRole = await prisma.role.findUnique({
    where: {
      name: "BUSINESS_OWNER",
    },
  });

  if (!businessOwnerRole) {
    throw new Error("BUSINESS_OWNER role not found.");
  }

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: businessOwner.id,
        roleId: businessOwnerRole.id,
      },
    },
    update: {},
    create: {
      userId: businessOwner.id,
      roleId: businessOwnerRole.id,
    },
  });

  console.log("Business owner seeded.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });