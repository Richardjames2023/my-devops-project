import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requestId } from "../src/common/middleware/requestId";

describe("request ID middleware", () => {
  const app = express();
  app.use(requestId);
  app.get("/", (_req, res) => res.json({ requestId: res.locals.requestId }));

  it("preserves a valid supplied request ID", async () => {
    const response = await request(app).get("/").set("x-request-id", "trace-123:abc");
    expect(response.headers["x-request-id"]).toBe("trace-123:abc");
    expect(response.body.requestId).toBe("trace-123:abc");
  });

  it("replaces invalid request IDs with a generated safe ID", async () => {
    const response = await request(app).get("/").set("x-request-id", "bad id-forged");
    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
