import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { EventEmitter } from "node:events";
import { httpLogger } from "../src/common/middleware/httpLogger";
import { requestId } from "../src/common/middleware/requestId";
import { logger } from "../src/config/logger";

describe("HTTP request logger", () => {
  afterEach(() => vi.restoreAllMocks());

  function createApp() {
    const app = express();
    app.use(requestId);
    app.use(httpLogger);
    app.get("/ok", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/client-error", (_req, res) => res.status(400).json({ error: "bad request" }));
    app.get("/server-error", (_req, res) => res.status(503).json({ error: "unavailable" }));
    return app;
  }

  it("logs successful requests with request ID and duration without query strings", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const response = await request(createApp()).get("/ok?access_token=must-not-be-logged");
    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("HTTP request completed", expect.objectContaining({
      method: "GET", path: "/ok", statusCode: 200,
      requestId: response.headers["x-request-id"], durationMs: expect.any(Number),
    }));
    expect(info.mock.calls[0]?.[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs 4xx responses as warnings", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const response = await request(createApp()).get("/client-error");
    expect(response.status).toBe(400);
    expect(warn).toHaveBeenCalledWith("HTTP request completed with client error", expect.objectContaining({
      statusCode: 400, method: "GET", path: "/client-error",
    }));
  });

  it("logs 5xx responses as errors", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const response = await request(createApp()).get("/server-error");
    expect(response.status).toBe(503);
    expect(error).toHaveBeenCalledWith("HTTP request failed", undefined, expect.objectContaining({
      statusCode: 503, method: "GET", path: "/server-error",
    }));
  });

  it("records connections closed before the response finishes", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const req = { method: "GET", path: "/slow" } as express.Request;
    const res = Object.assign(new EventEmitter(), {
      locals: { requestId: "req-aborted" }, statusCode: 200, writableFinished: false,
    }) as unknown as express.Response;
    const next = vi.fn();
    httpLogger(req, res, next);
    res.emit("close");
    expect(warn).toHaveBeenCalledWith(
      "HTTP request connection closed before response completed",
      expect.objectContaining({ method: "GET", path: "/slow", aborted: true, requestId: "req-aborted" }),
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
