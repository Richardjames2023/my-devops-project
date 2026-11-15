import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../src/common/utils/password";
import { assertNoActiveStaff, assertPendingOwnerAccount } from "./bootstrap-staff-owner.policy";

/**
 * Retrieves and validates a required environment variable.
 * Guarantees a string return type for TypeScript strict checks.
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return value;
}

// Required bootstrap configuration
const databaseUrl = getRequiredEnv("DATABASE_URL");
const email = getRequiredEnv("INITIAL_STAFF_OWNER_EMAIL")
  .trim()
  .toLowerCase();
const password = getRequiredEnv("INITIAL_STAFF_OWNER_PASSWORD");
const firstName = getRequiredEnv("INITIAL_STAFF_OWNER_FIRST_NAME").trim();
const lastName = getRequiredEnv("INITIAL_STAFF_OWNER_LAST_NAME").trim();

// Validate password strength
if (password.length < 16) {
  throw new Error(
    "INITIAL_STAFF_OWNER_PASSWORD must contain at least 16 characters.",
  );
}
if (!firstName || !lastName) {
  throw new Error("Initial staff owner first and last names are required.");
}

// Initialize Prisma with PostgreSQL adapter
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    // Recheck inside the transaction so concurrent bootstrap attempts cannot
    // both become the first active staff account.
    const activeStaffCount = await tx.staffAccount.count({
      where: { status: "ACTIVE" },
    });

    assertNoActiveStaff(activeStaffCount);

    const ownerRole = await tx.role.findUnique({
      where: { name: "BUSINESS_OWNER" },
    });

    if (!ownerRole) {
      throw new Error("BUSINESS_OWNER role is missing. Run the Prisma seed first.");
    }

    const existing = await tx.staffAccount.findUnique({
      where: { email },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });

    assertPendingOwnerAccount(existing);

    const staff = existing
      ? await tx.staffAccount.update({
          where: { id: existing.id },
          data: {
            firstName,
            lastName,
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        })
      : await tx.staffAccount.create({
          data: {
            email,
            firstName,
            lastName,
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        });

    await tx.staffAccountRole.upsert({
      where: {
        staffAccountId_roleId: {
          staffAccountId: staff.id,
          roleId: ownerRole.id,
        },
      },
      update: {},
      create: {
        staffAccountId: staff.id,
        roleId: ownerRole.id,
      },
    });

    await tx.auditLog.create({
      data: {
        staffAccountId: staff.id,
        action: existing
          ? "INITIAL_STAFF_OWNER_ACTIVATED"
          : "INITIAL_STAFF_OWNER_BOOTSTRAPPED",
        entity: "StaffAccount",
        entityId: staff.id,
        newValues: {
          email,
          role: "BUSINESS_OWNER",
          activatedExistingPendingAccount: Boolean(existing),
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  console.log("Initial BUSINESS_OWNER staff account created or activated successfully.");
}

main()
  .catch((error: unknown) => {
    console.error("Staff bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
