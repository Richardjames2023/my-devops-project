import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/AppError";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL must point to the dedicated shop_db_test database.");
}
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error("Safety check failed: delivery zone tests may only use shop_db_test.");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const { default: prisma } = await import("../src/infrastructure/prisma/client");
const {
  createDeliveryZone,
  quoteDeliveryFee,
  updateDeliveryZone,
} = await import("../src/modules/delivery-zones/delivery-zone.service");

describe("PostgreSQL delivery zones", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database.");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("matches normalized state and city, calculates the fee, and preserves inactive-zone rejection", async () => {
    const staffId = randomUUID();
    const suffix = randomUUID();
    const zoneName = `Delivery Zone ${suffix}`;
    let zoneId: string | undefined;

    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Zone', 'Administrator', 'ACTIVE', NOW(), NOW())`,
      [staffId, `${suffix}@delivery-zone-test.local`],
    );

    try {
      const zone = await createDeliveryZone(staffId, {
        name: zoneName,
        deliveryFee: 1850.5,
        locations: [
          { state: "ABUJA FCT", city: "WUSE" },
          { state: "ABUJA FCT", city: "GARKI" },
        ],
      });
      zoneId = zone.id;

      const quote = await quoteDeliveryFee(" abuja fct ", "wUsE");
      expect(quote).toMatchObject({
        zoneId,
        zoneName,
        currency: "NGN",
      });
      expect(quote.deliveryFee.toString()).toBe("1850.5");

      await updateDeliveryZone(staffId, zoneId, { deliveryFee: 2200, isActive: false });
      await expect(quoteDeliveryFee("ABUJA FCT", "WUSE")).rejects.toMatchObject({
        statusCode: 422,
      } satisfies Partial<AppError>);
    } finally {
      if (zoneId) {
        await pool.query(`DELETE FROM delivery_zones WHERE id = $1`, [zoneId]);
      }
      await pool.query(
        `DELETE FROM audit_logs WHERE "staffAccountId" = $1`,
        [staffId],
      );
      await pool.query(`DELETE FROM staff_accounts WHERE id = $1`, [staffId]);
    }
  });

  it("uses a state-wide regional zone as fallback and prefers an exact-city override", async () => {
    const staffId = randomUUID();
    const suffix = randomUUID();
    const state = "REGIONAL STATE " + suffix;
    const city = "OVERRIDE CITY " + suffix;
    const regionalName = "Regional Zone " + suffix;
    const cityName = "City Override " + suffix;
    let regionalZoneId: string | undefined;
    let cityZoneId: string | undefined;
    await pool.query('INSERT INTO staff_accounts (id, email, "firstName", "lastName", status, "createdAt", "updatedAt") VALUES ($1, $2, \'Zone\', \'Administrator\', \'ACTIVE\', NOW(), NOW())', [staffId, suffix + "@regional-zone-test.local"]);
    try {
      const regionalZone = await createDeliveryZone(staffId, { name: regionalName, deliveryFee: 4200, locations: [{ state, city: "*" }] });
      regionalZoneId = regionalZone.id;
      const fallbackQuote = await quoteDeliveryFee(state.toLowerCase(), "any city");
      expect(fallbackQuote).toMatchObject({ zoneId: regionalZoneId, zoneName: regionalName });
      expect(fallbackQuote.deliveryFee.toString()).toBe("4200");
      const cityZone = await createDeliveryZone(staffId, { name: cityName, deliveryFee: 1800, locations: [{ state, city }] });
      cityZoneId = cityZone.id;
      const overrideQuote = await quoteDeliveryFee(state, city.toLowerCase());
      expect(overrideQuote).toMatchObject({ zoneId: cityZoneId, zoneName: cityName });
      expect(overrideQuote.deliveryFee.toString()).toBe("1800");
    } finally {
      if (cityZoneId) await pool.query("DELETE FROM delivery_zones WHERE id = $1", [cityZoneId]);
      if (regionalZoneId) await pool.query("DELETE FROM delivery_zones WHERE id = $1", [regionalZoneId]);
      await pool.query('DELETE FROM audit_logs WHERE "staffAccountId" = $1', [staffId]);
      await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
    }
  });
  it("rejects an address that is not assigned to an active delivery zone", async () => {
    await expect(
      quoteDeliveryFee("NON-EXISTENT STATE", `CITY-${randomUUID()}`),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
