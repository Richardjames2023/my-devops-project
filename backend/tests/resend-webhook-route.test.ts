import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";

const webhookSecret = "whsec_" + Buffer.from("resend-route-test-secret").toString("base64");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/shop_db_test";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.JWT_ACCESS_SECRET ??= "resend-route-test-secret-at-least-32-characters";
process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
process.env.EMAIL_DELIVERY_ENABLED = "false";

const [{ default: app }] = await Promise.all([import("../src/app")]);

function headersFor(body: string, id: string, timestamp: number) {
  const signature = createHmac("sha256", Buffer.from(webhookSecret.slice(6), "base64"))
    .update(id + "." + timestamp + "." + body)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": "v1," + signature,
  };
}

describe("Resend webhook HTTP endpoint", () => {
  it("rejects requests without a valid Svix signature", async () => {
    await request(app)
      .post("/api/v1/notifications/webhooks/resend")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ type: "email.delivered", data: { email_id: "msg-1" } }))
      .expect(400);
  });

  it("verifies the raw request body before acknowledging unsupported provider events", async () => {
    const body = JSON.stringify({ type: "domain.updated", data: { id: "domain-1" } });
    const headers = headersFor(body, "svix-route-test-1", Math.floor(Date.now() / 1000));

    const response = await request(app)
      .post("/api/v1/notifications/webhooks/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body)
      .expect(200);

    expect(response.body).toEqual({ received: true, ignored: true });
  });

  it("rejects stale signed requests", async () => {
    const body = JSON.stringify({ type: "domain.updated", data: { id: "domain-2" } });
    const headers = headersFor(body, "svix-route-test-2", Math.floor(Date.now() / 1000) - 600);

    await request(app)
      .post("/api/v1/notifications/webhooks/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body)
      .expect(400);
  });
});
