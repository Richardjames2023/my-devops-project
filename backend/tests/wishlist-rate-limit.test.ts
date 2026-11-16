import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { wishlistMutationLimiter } from "../src/common/middleware/rate-limit.middleware";

describe("wishlist mutation rate limit", () => {
  it("returns 429 after 30 mutation requests from the same IP in 15 minutes", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.post("/wishlist", wishlistMutationLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const clientIp = "198.51.100.77";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app)
        .post("/wishlist")
        .set("X-Forwarded-For", clientIp);
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .post("/wishlist")
      .set("X-Forwarded-For", clientIp);

    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/too many wishlist changes/i);
  });
});
