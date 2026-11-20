import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff chat reply route tests may only use shop_db_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_ACCESS_SECRET ??= "staff-chat-reply-routes-secret-at-least-32-characters";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.EMAIL_DELIVERY_ENABLED = "false";
process.env.NODE_ENV = "test";

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const [
  { default: app },
  { generateAccessToken },
  { createConversation, requestHumanHandoff },
  { claimStaffChatConversation },
  { disconnectDatabase },
] = await Promise.all([
  import("../src/app"),
  import("../src/common/utils/jwt"),
  import("../src/modules/chat/chat.service"),
  import("../src/modules/chat/staff-chat.service"),
  import("../src/infrastructure/prisma/client"),
]);

type Actor = { id: string; token: string };
type Identity = "CUSTOMER" | "STAFF";
const customerIds: string[] = [];
const staffIds: string[] = [];
const roleIds: string[] = [];
const conversationIds: string[] = [];
const permissionNames = ["chat.reply", "chat.close"] as const;

async function ensurePermissions(): Promise<Map<string, string>> {
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
}): Promise<Actor> {
  const id = randomUUID();
  if (input.identityType === "CUSTOMER") {
    customerIds.push(id);
    await pool.query(
      `INSERT INTO users
       (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1, $2, 'test-hash', 'Route', 'Customer', NOW(), NOW())`,
      [id, `chat-reply-route-${id}@test.local`],
    );
  } else {
    staffIds.push(id);
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Route', 'Agent', 'ACTIVE', NOW(), NOW())`,
      [id, `chat-reply-route-${id}@test.local`],
    );
    const roleId = randomUUID();
    roleIds.push(roleId);
    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW())`,
      [roleId, `CHAT_REPLY_ROUTE_${roleId.replace(/-/g, "")}`],
    );
    const permissionIds = await ensurePermissions();
    for (const name of input.permissions ?? []) {
      const permissionId = permissionIds.get(name);
      if (!permissionId) throw new Error(`Permission ${name} is unavailable`);
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
      roles: input.identityType === "STAFF" ? ["BUSINESS_OWNER"] : ["CUSTOMER"],
      permissions: ["chat.reply", "chat.close"],
    }),
  };
}

describe("Staff chat reply and closure HTTP routes (PostgreSQL)", () => {
  let assignedAgent: Actor;
  let otherAgent: Actor;
  let unauthorizedAgent: Actor;
  let customer: Actor;
  let conversationId: string;

  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: staff chat reply route tests require shop_db_test");
    }
    await ensurePermissions();
    [assignedAgent, otherAgent, unauthorizedAgent, customer] = await Promise.all([
      createActor({ identityType: "STAFF", permissions: ["chat.reply", "chat.close"] }),
      createActor({ identityType: "STAFF", permissions: ["chat.reply", "chat.close"] }),
      createActor({ identityType: "STAFF" }),
      createActor({ identityType: "CUSTOMER" }),
    ]);
    const conversation = await createConversation({
      type: "CUSTOMER",
      id: customer.id,
    });
    conversationId = conversation.id;
    conversationIds.push(conversation.id);
    await requestHumanHandoff({ type: "CUSTOMER", id: customer.id }, conversation.id);
    await claimStaffChatConversation(conversation.id, assignedAgent.id);
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

  it("requires the granular chat.reply and chat.close grants", async () => {
    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${unauthorizedAgent.token}`)
      .send({ content: "No permission", clientMessageId: randomUUID() })
      .expect(403);
    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/close`)
      .set("Authorization", `Bearer ${unauthorizedAgent.token}`)
      .expect(403);
    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ content: "Customer cannot use staff endpoint", clientMessageId: randomUUID() })
      .expect(403);
  });

  it("validates reply input and allows only the assigned active agent to reply", async () => {
    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .send({ content: " ", clientMessageId: randomUUID() })
      .expect(400);

    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${otherAgent.token}`)
      .send({ content: "Not assigned", clientMessageId: randomUUID() })
      .expect(403);

    const clientMessageId = randomUUID();
    const response = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .send({ content: "I am checking this for you.", clientMessageId })
      .expect(201);
    expect(response.body.data.message).toMatchObject({
      senderType: "AGENT",
      senderAgentId: assignedAgent.id,
      content: "I am checking this for you.",
      clientMessageId,
    });

    const retry = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .send({ content: "I am checking this for you.", clientMessageId })
      .expect(201);
    expect(retry.body.data.message.id).toBe(response.body.data.message.id);
  });

  it("closes the conversation idempotently and rejects later replies", async () => {
    const closed = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/close`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .expect(200);
    expect(closed.body.data.conversation).toMatchObject({
      id: conversationId,
      status: "CLOSED",
      assignedAgentId: assignedAgent.id,
    });

    const retry = await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/close`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .expect(200);
    expect(retry.body.data.conversation.status).toBe("CLOSED");

    await request(app)
      .post(`/api/v1/staff/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${assignedAgent.token}`)
      .send({ content: "Too late", clientMessageId: randomUUID() })
      .expect(409);
  });
});
