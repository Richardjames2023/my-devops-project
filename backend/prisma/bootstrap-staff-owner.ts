import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../src/common/utils/password";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.INITIAL_STAFF_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.INITIAL_STAFF_OWNER_PASSWORD;
const firstName = process.env.INITIAL_STAFF_OWNER_FIRST_NAME?.trim();
const lastName = process.env.INITIAL_STAFF_OWNER_LAST_NAME?.trim();

if (!databaseUrl || !email || !password || !firstName || !lastName) {
  throw new Error(
    "Set DATABASE_URL, INITIAL_STAFF_OWNER_EMAIL, INITIAL_STAFF_OWNER_PASSWORD, INITIAL_STAFF_OWNER_FIRST_NAME and INITIAL_STAFF_OWNER_LAST_NAME.",
  );
}
if (password.length < 16) {
  throw new Error("INITIAL_STAFF_OWNER_PASSWORD must contain at least 16 characters.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const activeStaffCount = await prisma.staffAccount.count({ where: { status: "ACTIVE" } });
  if (activeStaffCount > 0) {
    throw new Error("An active staff account already exists. Bootstrap is only allowed before staff activation.");
  }

  const existing = await prisma.staffAccount.findUnique({ where: { email } });
  if (existing) {
    throw new Error("A staff account already exists for this email. Use the invitation/reset workflow instead.");
  }

  const ownerRole = await prisma.role.findUnique({ where: { name: "BUSINESS_OWNER" } });
  if (!ownerRole) {
    throw new Error("BUSINESS_OWNER role is missing. Run the Prisma seed first.");
  }

  const passwordHash = await hashPassword(password);
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
      data: { staffAccountId: staff.id, roleId: ownerRole.id },
    });
    await tx.auditLog.create({
      data: {
        staffAccountId: staff.id,
        action: "INITIAL_STAFF_OWNER_BOOTSTRAPPED",
        entity: "StaffAccount",
        entityId: staff.id,
        newValues: { email, role: "BUSINESS_OWNER" },
      },
    });
  });

  console.log("Initial BUSINESS_OWNER staff account created successfully.");
}

main()
  .catch((error) => {
    console.error("Staff bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
