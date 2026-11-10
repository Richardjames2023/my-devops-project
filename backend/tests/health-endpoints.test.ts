import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import prisma from "../src/infrastructure/prisma/client";
import app from "../src/app";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("health endpoints", () => {
  it("keeps /health as a lightweight liveness check", async () => {
    const databaseCheck = vi.spyOn(prisma, "$queryRaw");

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "UP" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(databaseCheck).not.toHaveBeenCalled();
  });

  it("exposes an explicit liveness endpoint", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "UP" });
  });

  it("reports readiness when the database query succeeds", async () => {
    const databaseCheck = vi
      .spyOn(prisma, "$queryRaw")
      .mockResolvedValue([] as never);

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "READY",
      checks: {
        database: "UP",
      },
    });
    expect(databaseCheck).toHaveBeenCalledOnce();
  });

  it("returns 503 without leaking database details when the database query fails", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(
      new Error("sensitive database connection details"),
    );

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "NOT_READY",
      checks: {
        database: "DOWN",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "sensitive database connection details",
    );
  });
});
