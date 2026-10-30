
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated shop_db_test database.",
  );
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: integration tests may only use shop_db_test.",
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

afterAll(async () => {
  await pool.end();
});

describe("PostgreSQL webhook recovery claim", () => {
  it("allows only one of two concurrent claims to succeed", async () => {
    const eventId = randomUUID();
    const eventKey = `postgres-claim-test-${randomUUID()}`;

    const setup = await pool.connect();

    try {
      await setup.query(
        `INSERT INTO processed_webhook_events
          (id, "eventKey", "eventType", status, "processingStartedAt")
         VALUES ($1, $2, $3, 'PROCESSING', NOW() - INTERVAL '15 minutes')`,
        [eventId, eventKey, "refund.processing"],
      );
    } finally {
      setup.release();
    }

    try {
      const claim = async (token: string): Promise<number> => {
        const connection = await pool.connect();

        try {
          const result = await connection.query(
            `UPDATE processed_webhook_events
             SET status = 'RECOVERING',
                 "recoveryStartedAt" = NOW(),
                 "recoveryToken" = $1
             WHERE id = $2
               AND status = 'PROCESSING'
               AND "processingStartedAt" < NOW() - INTERVAL '5 minutes'
               AND "recoveryToken" IS NULL
             RETURNING id`,
            [token, eventId],
          );

          return result.rowCount ?? 0;
        } finally {
          connection.release();
        }
      };

      const results = await Promise.all([
        claim(randomUUID()),
        claim(randomUUID()),
      ]);

      expect(results.reduce((total, count) => total + count, 0)).toBe(1);

      const finalState = await pool.query(
        `SELECT status, "recoveryToken"
         FROM processed_webhook_events
         WHERE id = $1`,
        [eventId],
      );

      expect(finalState.rows).toHaveLength(1);
      expect(finalState.rows[0].status).toBe("RECOVERING");
      expect(finalState.rows[0].recoveryToken).toBeTruthy();
    } finally {
      await pool.query(
        `DELETE FROM processed_webhook_events WHERE id = $1`,
        [eventId],
      );
    }
  });
});
