import "dotenv/config";
import { defineConfig } from "vitest/config";

// Load the dedicated integration-test database before Vitest evaluates any
// application modules. The application Prisma client reads DATABASE_URL once
// when its environment module is initialized, so changing it inside an
// individual test file can be too late.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  const parsedTestDatabaseUrl = new URL(testDatabaseUrl);

  if (parsedTestDatabaseUrl.pathname !== "/shop_db_test") {
    throw new Error(
      "Safety check failed: Vitest may only use the shop_db_test database",
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
