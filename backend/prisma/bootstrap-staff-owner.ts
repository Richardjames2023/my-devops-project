
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../src/common/utils/password";

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

// Initialize Prisma with PostgreSQL adapter
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  // Bootstrap is only permitted before any staff account becomes active.
  const activeStaffCount = await prisma.staffAccount.count({
    where: { status: "ACTIVE" },
  });

  if (activeStaffCount > 0) {
    throw new Error(
      "An active staff account already exists. Bootstrap is only allowed before staff activation.",
    );
  }

  // Prevent duplicate staff accounts.
  const existing = await prisma.staffAccount.findUnique({
    where: { email },
  });

  if (existing) {
    throw new Error(
      "A staff account already exists for this email. Use the invitation/reset workflow instead.",
    );
  }

  // Retrieve the BUSINESS_OWNER role.
  const ownerRole = await prisma.role.findUnique({
    where: { name: "BUSINESS_OWNER" },
  });

  if (!ownerRole) {
    throw new Error(
      "BUSINESS_OWNER role is missing. Run the Prisma seed first.",
    );
  }

  // Hash the initial owner's password.
  const passwordHash = await hashPassword(password);

  // Create the staff account, assign its role and record the audit event atomically.
  await prisma.$transaction(async (tx) => {
    const staff = await tx.staffAccount.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    await tx.staffAccountRole.create({
      data: {
        staffAccountId: staff.id,
        roleId: ownerRole.id,
      },
    });

    await tx.auditLog.create({
      data: {
        staffAccountId: staff.id,
        action: "INITIAL_STAFF_OWNER_BOOTSTRAPPED",
        entity: "StaffAccount",
        entityId: staff.id,
        newValues: {
          email,
          role: "BUSINESS_OWNER",
        },
      },
    });
  });

  console.log(
    "Initial BUSINESS_OWNER staff account created successfully.",
  );
}

main()
  .catch((error: unknown) => {
    console.error("Staff bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
