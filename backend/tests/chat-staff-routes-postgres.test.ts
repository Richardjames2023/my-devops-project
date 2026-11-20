import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff chat route tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "staff-chat-routes-test-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [
  { default: app },
  { generateAccessToken },
  { createConversation, requestHumanHandoff },
  { disconnectDatabase },
] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/modules/chat/chat.service"),
  import("../src/infrastructure/prisma/client"),
]);

type Identity = "CUSTOMER" | "STAFF";
type Actor = { id: string; token: string };

const customerIds: string[] = [];
const staffIds: string[] = [];
const roleIds: string[] = [];
const conversationIds: string[] = [];
const permissionNames = ["chat.read", "chat.assign"] as const;

async function ensureChatPermissions(): Promise<Map<string, string>> {
  for (const name of permissionNames) {
    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, $2, NOW()) ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), name],
    );
  }

  const result = await pool.query(
    "SELECT id, name FROM permissions WHERE name = ANY($1::text[])",
    [[...permissionNames]],
  );
  return new Map(result.rows.map((row: { id: string; name: string }) => [row.name, row.id]));
}

async function createActor(input: {
  identityType: Identity;
  permissions?: string[];
  status?: "ACTIVE" | "SUSPENDED";
}): Promise<Actor> {
  const id = randomUUID();

  if (input.identityType === "CUSTOMER") {
    customerIds.push(id);
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, 'test-hash', 'Chat', 'Customer', NOW(), NOW())`,
      [id, `chat-route-${id}@test.local`],
    );
  } else {
    staffIds.push(id);
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Route', 'Agent', $3, NOW(), NOW())`,
      [id, `chat-route-${id}@test.local`, input.status ?? "ACTIVE"],
    );

    const roleId = randomUUID();
    roleIds.push(roleId);
    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, `CHAT_ROUTE_TEST_${roleId.replace(/-/g, "")}`],
    );

    const permissions = await ensureChatPermissions();
    for (const permissionName of input.permissions ?? []) {
      const permissionId = permissions.get(permissionName);
      if (!permissionId) throw new Error(`Permission ${permissionName} is unavailable`);
      await pool.query(
        `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
         VALUES ($1, $2, $3, NOW())`,
        [randomUUID(), roleId, permissionId],
      );
    }

    await pool.query(
      `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), id, roleId],
    );
  }

  return {
    id,
    token: generateAccessToken({
      sub: id,
      identityType: input.identityType,
      // Deliberately include claimed permissions in the JWT. authorize()
      // must resolve the current database grants instead of trusting these.
      roles: input.identityType === "STAFF" ? ["BUSINESS_OWNER"] : ["CUSTOMER"],
      permissions: ["chat.read", "chat.assign"],
    }),
  };
}

async function createWaitingConversation(customer: Actor): Promise<string> {
  const conversation = await createConversation({
    type: "CUSTOMER",
    id: customer.id,
  });
  conversationIds.push(conversation.id);
  await requestHumanHandoff(
    { type: "CUSTOMER", id: customer.id },
    conversation.id,
  );
  return conversation.id;
}

describe("Staff chat HTTP routes (PostgreSQL)", () => {
  let customer: Actor;
  let fullyAuthorizedStaff: Actor;
  let readOnlyStaff: Actor;
  let unauthorizedStaff: Actor;
  let suspendedStaff: Actor;
  let conversationId: string;

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: staff chat route tests require shop_db_test");
    }

    await ensureChatPermissions();
    [customer, fullyAuthorizedStaff, readOnlyStaff, unauthorizedStaff, suspendedStaff] =
      await Promise.all([
        createActor({ identityType: "CUSTOMER" }),
        createActor({ identityType: "STAFF", permissions: ["chat.read", "chat.assign"] }),
        createActor({ identityType: "STAFF", permissions: ["chat.read"] }),
        createActor({ identityType: "STAFF" }),
        createActor({
          identityType: "STAFF",
          permissions: ["chat.read", "chat.assign"],
          status: "SUSPENDED",
        }),
      ]);

    conversationId = await createWaitingConversation(customer);
  });

  afterAll(async () => {
    try {
      if (conversationIds.length) {
        await pool.query(
          "DELETE FROM chat_conversations WHERE id = ANY($1::uuid[])",
          [conversationIds],
        );
      }
      if (staffIds.length) {
        await pool.query(
          'DELETE FROM staff_account_roles WHERE "staffAccountId" = ANY($1::uuid[])',
          [staffIds],
        );
        await pool.query("DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])", [staffIds]);
      }
      if (roleIds.length) {
        await pool.query(
          'DELETE FROM role_permissions WHERE "roleId" = ANY($1::uuid[])',
          [roleIds],
        );
        await pool.query("DELETE FROM roles WHERE id = ANY($1::uuid[])", [roleIds]);
      }
      if (customerIds.length) {
        await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [customerIds]);
      }
    } finally {
      await disconnectDatabase();
      await pool.end();
    }
  });

  it("requires authentication and rejects customer identities", async () => {
    await request(app).get("/api/v1/staff/chat/conversations").expect(401);

    await request(app)
      .get("/api/v1/staff/chat/conversations")
      .set("Authorization", `Bearer ${customer.token}`)
      .expect(403);
  });

  it("resolves chat.read from active database role grants, not JWT claims", async () => {
    await request(app)
      .get("/api/v1/staff/chat/conversations")
      .set("Authorization", `Bearer ${unauthorizedStaff.token}`)
      .expect(403);

    const response = await request(app)
      .get("/api/v1/staff/chat/conversations")
      .set("Authorization", `Bearer ${readOnlyStaff.token}`)
      .expect(200);

    expect(response.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: conversationId,
          status: "WAITING_FOR_AGENT",
        }),
      ]),
    );
  });

  it("protects transcript retrieval and validates route parameters and query limits", async () => {
    const transcript = await request(app)
      .get(`/api/v1/staff/chat/conversations/${conversationId}?messageLimit=10`)
      .set("Authorization", `Bearer ${readOnlyStaff.token}`)
      .expect(200);

    expect(transcript.body.data.conversation).toMatchObject({
      id: conversationId,
      status: "WAITING_FOR_AGENT",
    });
    expect(transcript.body.data.conversation.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "HANDOFF_REQUESTED" }),
      ]),
    );

    await request(app)
      .get("/api/v1/staff/chat/conversations/not-a-uuid")
      .set("Authorization", `Bearer ${readOnlyStaff.token}`)
      .expect(400);

    await request(app)
      .get(`/api/v1/staff/chat/conversations/${conversationId}?messageLimit=101`)
      .set("Authorization", `Bearer ${readOnlyStaff.token}`)
      .expect(400);
  });

  it("requires chat.assign and refuses inactive staff even when the token claims permission", async () => {
    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/assign`)
      .set("Authorization", `Bearer ${readOnlyStaff.token}`)
      .expect(403);

    await request(app)
      .get("/api/v1/staff/chat/conversations")
      .set("Authorization", `Bearer ${suspendedStaff.token}`)
      .expect(403);
  });

  it("allows an authorized active agent to claim through the HTTP endpoint", async () => {
    const response = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/assign`)
      .set("Authorization", `Bearer ${fullyAuthorizedStaff.token}`)
      .expect(200);

    expect(response.body.data.conversation).toMatchObject({
      id: conversationId,
      status: "HUMAN_ACTIVE",
      assignedAgentId: fullyAuthorizedStaff.id,
    });

    const repeatedClaim = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/assign`)
      .set("Authorization", `Bearer ${fullyAuthorizedStaff.token}`)
      .expect(200);

    expect(repeatedClaim.body.data.conversation.assignedAgentId).toBe(
      fullyAuthorizedStaff.id,
    );
  });
});
