import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  wishlistMutationLimiter,
  wishlistReadLimiter,
} from "../src/common/middleware/rate-limit.middleware";

function createApp(limiter: typeof wishlistMutationLimiter) {
  const app = express();
  app.use((req, _res, next) => {
    (req as Request & { user?: { id: string } }).user = {
      id: req.header("X-Customer-ID") ?? "customer-default",
    };
    next();
  });
  app.all("/wishlist", limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("wishlist rate limits", () => {
  it("limits mutations to 30 requests per customer in 15 minutes", async () => {
    const app = createApp(wishlistMutationLimiter);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app)
        .post("/wishlist")
        .set("X-Customer-ID", "wishlist-customer-mutation-limit");
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .post("/wishlist")
      .set("X-Customer-ID", "wishlist-customer-mutation-limit");

    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/too many wishlist changes/i);

    const otherCustomer = await request(app)
      .post("/wishlist")
      .set("X-Customer-ID", "wishlist-customer-other");
    expect(otherCustomer.status).toBe(200);
  });

  it("limits reads to 60 requests per customer in 15 minutes", async () => {
    const app = createApp(wishlistReadLimiter);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await request(app)
        .get("/wishlist")
        .set("X-Customer-ID", "wishlist-customer-read-limit");
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .get("/wishlist")
      .set("X-Customer-ID", "wishlist-customer-read-limit");

    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/too many wishlist requests/i);
  });
});
