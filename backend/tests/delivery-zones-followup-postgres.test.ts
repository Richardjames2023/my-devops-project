import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/AppError";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated shop_db_test database.",
  );
}

const parsedUrl = new URL(databaseUrl);
if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: delivery-zone follow-up tests may only use shop_db_test.",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const { default: prisma } = await import(
  "../src/infrastructure/prisma/client"
);

const {
  createDeliveryZone,
  quoteDeliveryFee,
  updateDeliveryZone,
} = await import("../src/modules/delivery-zones/delivery-zone.service");

async function createStaffFixture() {
  const id = randomUUID();
  const suffix = randomUUID();

  await pool.query(
    `INSERT INTO staff_accounts
     (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Zone', 'Test', 'ACTIVE', NOW(), NOW())`,
    [id, `${suffix}@delivery-zone-followup.local`],
  );

  return id;
}

async function cleanup(staffId: string, zoneIds: string[] = []) {
  if (zoneIds.length) {
    await pool.query("DELETE FROM delivery_zones WHERE id = ANY($1::uuid[])", [
      zoneIds,
    ]);
  }

  await pool.query('DELETE FROM audit_logs WHERE "staffAccountId" = $1', [
    staffId,
  ]);

  await pool.query("DELETE FROM staff_accounts WHERE id = $1", [staffId]);
}

describe("PostgreSQL delivery-zone review follow-ups", () => {
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

  it("rejects duplicate zone names and locations assigned to another zone", async () => {
    const staffId = await createStaffFixture();
    const firstZoneId: string[] = [];
    const suffix = randomUUID();

    const location = {
      state: "ABUJA FCT",
      city: `CENTRAL-${suffix}`.toUpperCase(),
    };

    try {
      const first = await createDeliveryZone(staffId, {
        name: `Unique Zone ${suffix}`,
        deliveryFee: 1000,
        locations: [location],
      });

      firstZoneId.push(first.id);

      await expect(
        createDeliveryZone(staffId, {
          name: first.name,
          deliveryFee: 1200,
          locations: [
            {
              state: "KADUNA",
              city: `OTHER-${suffix}`.toUpperCase(),
            },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 409 } satisfies Partial<AppError>);

      await expect(
        createDeliveryZone(staffId, {
          name: `Second Zone ${suffix}`,
          deliveryFee: 1500,
          locations: [location],
        }),
      ).rejects.toMatchObject({ statusCode: 409 } satisfies Partial<AppError>);

      const persisted = await pool.query(
        "SELECT id FROM delivery_zones WHERE name = $1",
        [first.name],
      );

      expect(persisted.rows).toHaveLength(1);

      const failedCreateLogs = await pool.query(
        'SELECT id FROM audit_logs WHERE "staffAccountId" = $1 AND action = $2',
        [staffId, "DELIVERY_ZONE_CREATED"],
      );

      expect(failedCreateLogs.rows).toHaveLength(1);
    } finally {
      await cleanup(staffId, firstZoneId);
    }
  });

  it("replaces locations, supports reactivation, and records create/update audit snapshots", async () => {
    const staffId = await createStaffFixture();
    const zoneIds: string[] = [];
    const suffix = randomUUID();

    const oldLocation = {
      state: "GOMBE",
      city: `OLD-${suffix}`.toUpperCase(),
    };

    const newLocation = {
      state: "ABUJA FCT",
      city: `NEW-${suffix}`.toUpperCase(),
    };

    try {
      const created = await createDeliveryZone(staffId, {
        name: `Mutable Zone ${suffix}`,
        deliveryFee: 800,
        locations: [oldLocation],
      });

      zoneIds.push(created.id);

      await updateDeliveryZone(staffId, created.id, {
        locations: [newLocation],
        deliveryFee: 1250,
        isActive: false,
      });

      await expect(
        quoteDeliveryFee(oldLocation.state, oldLocation.city),
      ).rejects.toMatchObject({ statusCode: 422 });

      await expect(
        quoteDeliveryFee(newLocation.state, newLocation.city),
      ).rejects.toMatchObject({ statusCode: 422 });

      await updateDeliveryZone(staffId, created.id, {
        isActive: true,
      });

      const quote = await quoteDeliveryFee(
        newLocation.state,
        newLocation.city,
      );

      expect(quote).toMatchObject({
        zoneId: created.id,
        zoneName: created.name,
        currency: "NGN",
      });

      expect(quote.deliveryFee.toString()).toBe("1250");

      await expect(
        quoteDeliveryFee(oldLocation.state, oldLocation.city),
      ).rejects.toMatchObject({ statusCode: 422 });

      const locations = await pool.query(
        'SELECT state, city FROM delivery_zone_locations WHERE "zoneId" = $1',
        [created.id],
      );

      expect(locations.rows).toEqual([
        {
          state: newLocation.state,
          city: newLocation.city,
        },
      ]);

      const auditLogs = await pool.query(
        `SELECT action, "oldValues", "newValues"
         FROM audit_logs
         WHERE "staffAccountId" = $1 AND "entityId" = $2
         ORDER BY "createdAt" ASC`,
        [staffId, created.id],
      );

      expect(auditLogs.rows).toHaveLength(3);

      expect(auditLogs.rows[0].action).toBe("DELIVERY_ZONE_CREATED");

      expect(auditLogs.rows[0].newValues).toMatchObject({
        name: created.name,
        deliveryFee: "800",
        locations: [
          {
            state: oldLocation.state,
            city: oldLocation.city,
          },
        ],
      });

      expect(auditLogs.rows[1].action).toBe("DELIVERY_ZONE_UPDATED");

      expect(auditLogs.rows[1].oldValues).toMatchObject({
        isActive: true,
        locations: [
          {
            state: oldLocation.state,
            city: oldLocation.city,
          },
        ],
      });

      expect(auditLogs.rows[1].newValues).toMatchObject({
        isActive: false,
        deliveryFee: "1250",
        locations: [
          {
            state: newLocation.state,
            city: newLocation.city,
          },
        ],
      });

      expect(auditLogs.rows[2].newValues).toMatchObject({
        isActive: true,
      });
    } finally {
      await cleanup(staffId, zoneIds);
    }
  });
});