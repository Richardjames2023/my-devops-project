import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const cloudinaryMocks = vi.hoisted(() => ({
  uploadStream: vi.fn(),
  privateDownloadUrl: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("../src/config/cloudinary", () => ({
  getCloudinary: () => ({
    uploader: {
      upload_stream: cloudinaryMocks.uploadStream,
      destroy: cloudinaryMocks.destroy,
    },
    utils: {
      private_download_url: cloudinaryMocks.privateDownloadUrl,
    },
  }),
}));

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.pathname !== "/shop_db_test") {
  throw new Error(
    "Safety check failed: guest return evidence tests may only use shop_db_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const {
  assertGuestReturnEvidenceOrderAccess,
  createGuestReturnEvidence,
  disconnectDatabase,
  getGuestReturnEvidenceViewUrl,
  getGuestReturnEvidenceFileSource,
} = await import("../src/modules/return/return-evidence.service").then(
  async (service) => {
    const database = await import("../src/infrastructure/prisma/client");
    const view = await import("../src/modules/return/return-evidence-view.service");

    return {
      assertGuestReturnEvidenceOrderAccess:
        service.assertGuestReturnEvidenceOrderAccess,
      createGuestReturnEvidence: service.createGuestReturnEvidence,
      disconnectDatabase: database.disconnectDatabase,
      getGuestReturnEvidenceViewUrl: view.getGuestReturnEvidenceViewUrl,
      getGuestReturnEvidenceFileSource: view.getGuestReturnEvidenceFileSource,
    };
  },
);

interface Fixture {
  orderIds: string[];
  returnRequestIds: string[];
}

function makeToken(): string {
  return randomUUID().replace(/-/g, "").repeat(2);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeJpeg(): Buffer {
  // Minimal JPEG header and frame data accepted by file-type.
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8BP//Z",
    "base64",
  );
}

async function createFixture(): Promise<{
  fixture: Fixture;
  tokens: string[];
}> {
  const fixture: Fixture = { orderIds: [], returnRequestIds: [] };
  const tokens = [makeToken(), makeToken()];

  try {
    for (let index = 0; index < tokens.length; index++) {
      const orderId = randomUUID();
      const returnRequestId = randomUUID();
      fixture.orderIds.push(orderId);
      fixture.returnRequestIds.push(returnRequestId);

      await pool.query(
        `INSERT INTO orders
         (id, "orderNumber", status, subtotal, "totalAmount", "shippingAddress",
          "guestAccessTokenHash", "guestAccessTokenExpiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, 'FULFILLED', 100, 100, $3, $4,
                 timezone('UTC', NOW()) + INTERVAL '2 years', NOW(), NOW())`,
        [
          orderId,
          `GUEST-EVIDENCE-${orderId}`,
          JSON.stringify({ fullName: "Evidence Test Guest" }),
          hashToken(tokens[index]),
        ],
      );

      await pool.query(
        `INSERT INTO return_requests
         (id, "orderId", status, reason, "requestedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, 'PENDING', 'Evidence integration test', NOW(), NOW(), NOW())`,
        [returnRequestId, orderId],
      );
    }

    return { fixture, tokens };
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  if (fixture.orderIds.length === 0) return;

  await pool.query(
    `DELETE FROM return_evidence
     WHERE "returnRequestId" = ANY($1::uuid[])`,
    [fixture.returnRequestIds],
  );
  await pool.query(
    `DELETE FROM return_requests WHERE id = ANY($1::uuid[])`,
    [fixture.returnRequestIds],
  );
  await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
    fixture.orderIds,
  ]);
}

describe("PostgreSQL guest return evidence access", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");

    if (result.rows[0]?.name !== "shop_db_test") {
      throw new Error(
        "Safety check failed: connected to the wrong database",
      );
    }

    cloudinaryMocks.uploadStream.mockImplementation(
      (_options: unknown, callback: (error: null, result: {
        public_id: string;
        secure_url: string;
      }) => void) => ({
        end: () =>
          callback(null, {
            public_id: `guest-return-evidence/${randomUUID()}`,
            secure_url: "https://cloudinary.example/private-evidence",
          }),
      }),
    );
    cloudinaryMocks.privateDownloadUrl.mockReturnValue(
      "https://cloudinary.example/signed-private-evidence",
    );
    cloudinaryMocks.destroy.mockResolvedValue({ result: "ok" });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await pool.end();
  });

  it("uploads and retrieves evidence only for the guest order authorized by its token", async () => {
    const { fixture, tokens } = await createFixture();
    const [orderId, otherOrderId] = fixture.orderIds;
    const [returnRequestId, otherReturnRequestId] = fixture.returnRequestIds;
    const [token] = tokens;

    try {
      await expect(
        assertGuestReturnEvidenceOrderAccess(orderId, token),
      ).resolves.toBeUndefined();

      const uploaded = await createGuestReturnEvidence(
        returnRequestId,
        orderId,
        token,
        [
          {
            buffer: makeJpeg(),
            originalname: "condition.jpg",
            mimetype: "image/jpeg",
          } as Express.Multer.File,
        ],
      );

      expect(uploaded).toHaveLength(1);
      const evidenceId = uploaded[0]?.id;
      expect(evidenceId).toBeTruthy();
      expect(cloudinaryMocks.uploadStream).toHaveBeenCalledTimes(1);

      const view = await getGuestReturnEvidenceViewUrl(
        evidenceId!,
        orderId,
        token,
      );
      expect(view).toMatchObject({
        id: evidenceId,
        returnRequestId,
        type: "image/jpeg",
        viewUrl: `/api/v1/returns/guest/${orderId}/evidence/${evidenceId}/file`,
      });

      const source = await getGuestReturnEvidenceFileSource(
        evidenceId!,
        orderId,
        token,
      );
      expect(source).toEqual({
        type: "image/jpeg",
        signedUrl: "https://cloudinary.example/signed-private-evidence",
      });

      await expect(
        getGuestReturnEvidenceViewUrl(evidenceId!, otherOrderId!, token),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        getGuestReturnEvidenceViewUrl(evidenceId!, orderId, tokens[1]),
      ).rejects.toThrow("Return evidence not found");

      await expect(
        createGuestReturnEvidence(
          otherReturnRequestId!,
          orderId,
          token,
          [
            {
              buffer: makeJpeg(),
              originalname: "wrong-order.jpg",
              mimetype: "image/jpeg",
            } as Express.Multer.File,
          ],
        ),
      ).rejects.toThrow("Return request not found");
      expect(cloudinaryMocks.uploadStream).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects expired guest tokens for upload, metadata, and file access", async () => {
    const { fixture, tokens } = await createFixture();
    const [orderId] = fixture.orderIds;
    const [returnRequestId] = fixture.returnRequestIds;
    const [token] = tokens;

    try {
      await pool.query(
        `UPDATE orders
         SET "guestAccessTokenExpiresAt" = timezone('UTC', NOW()) - INTERVAL '1 second'
         WHERE id = $1`,
        [orderId],
      );

      await expect(
        assertGuestReturnEvidenceOrderAccess(orderId!, token),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        createGuestReturnEvidence(returnRequestId!, orderId!, token, [
          {
            buffer: makeJpeg(),
            originalname: "expired.jpg",
            mimetype: "image/jpeg",
          } as Express.Multer.File,
        ]),
      ).rejects.toThrow("Return request not found");
      await expect(
        getGuestReturnEvidenceViewUrl(randomUUID(), orderId!, token),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        getGuestReturnEvidenceFileSource(randomUUID(), orderId!, token),
      ).rejects.toThrow("Return evidence not found");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects revoked guest tokens for upload and evidence retrieval", async () => {
    const { fixture, tokens } = await createFixture();
    const [orderId] = fixture.orderIds;
    const [returnRequestId] = fixture.returnRequestIds;
    const [token] = tokens;

    try {
      await pool.query(
        `UPDATE orders SET "guestAccessTokenRevokedAt" = NOW() WHERE id = $1`,
        [orderId],
      );

      await expect(
        assertGuestReturnEvidenceOrderAccess(orderId!, token),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        createGuestReturnEvidence(returnRequestId!, orderId!, token, [
          {
            buffer: makeJpeg(),
            originalname: "revoked.jpg",
            mimetype: "image/jpeg",
          } as Express.Multer.File,
        ]),
      ).rejects.toThrow("Return request not found");
      await expect(
        getGuestReturnEvidenceViewUrl(randomUUID(), orderId!, token),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        getGuestReturnEvidenceFileSource(randomUUID(), orderId!, token),
      ).rejects.toThrow("Return evidence not found");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not expose another guest order's evidence when a different order token is supplied", async () => {
    const { fixture, tokens } = await createFixture();
    const [orderId, otherOrderId] = fixture.orderIds;
    const [returnRequestId] = fixture.returnRequestIds;
    const [, otherToken] = tokens;

    try {
      const uploaded = await createGuestReturnEvidence(
        returnRequestId!,
        orderId!,
        tokens[0]!,
        [
          {
            buffer: makeJpeg(),
            originalname: "private.jpg",
            mimetype: "image/jpeg",
          } as Express.Multer.File,
        ],
      );
      const evidenceId = uploaded[0]!.id;

      await expect(
        getGuestReturnEvidenceViewUrl(evidenceId, otherOrderId!, otherToken!),
      ).rejects.toThrow("Return evidence not found");
      await expect(
        getGuestReturnEvidenceFileSource(
          evidenceId,
          otherOrderId!,
          otherToken!,
        ),
      ).rejects.toThrow("Return evidence not found");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
