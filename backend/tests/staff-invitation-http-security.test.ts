import express from "express";
import cookieParser from "cookie-parser";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test",
    COOKIE_SAME_SITE: "lax",
    STAFF_INVITATION_ACCEPTANCE_URL: "https://app.example.com/staff/accept-invitation",
    APP_BASE_URL: undefined,
  },
  exchangeStaffInvitationToken: vi.fn(),
  acceptStaffInvitation: vi.fn(),
}));

vi.mock("../src/config/env", () => ({ env: mocks.env }));
vi.mock("../src/modules/staff/staff.service", () => ({
  exchangeStaffInvitationToken: mocks.exchangeStaffInvitationToken,
  acceptStaffInvitation: mocks.acceptStaffInvitation,
  getStaffProfile: vi.fn(),
  loginStaff: vi.fn(),
  refreshStaffAccessToken: vi.fn(),
}));

import staffAuthRoutes from "../src/modules/staff/staff-auth.routes";

const expectedOrigin = "https://app.example.com";
const invitationToken = "a".repeat(64);
const validAcceptance = {
  firstName: "Taylor",
  lastName: "Staff",
  password: "A-strong-password-2026",
};

function createApp() {
  const app = express();
  // Trust one proxy hop so rate-limit tests can isolate client IP buckets.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/staff-auth", staffAuthRoutes);
  return app;
}

function expectNoStoreHeaders(response: supertest.Response) {
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers.pragma).toBe("no-cache");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
}

describe("staff invitation HTTP security boundaries", () => {
  beforeEach(() => {
    mocks.env.NODE_ENV = "test";
    mocks.env.COOKIE_SAME_SITE = "lax";
    mocks.env.STAFF_INVITATION_ACCEPTANCE_URL = "https://app.example.com/staff/accept-invitation";
    mocks.env.APP_BASE_URL = undefined;
    mocks.exchangeStaffInvitationToken.mockReset();
    mocks.acceptStaffInvitation.mockReset();
    mocks.exchangeStaffInvitationToken.mockResolvedValue({
      sessionToken: "opaque-session-secret",
      expiresAt: new Date("2026-11-14T13:00:00.000Z"),
    });
    mocks.acceptStaffInvitation.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "staff@example.com",
      firstName: "Taylor",
      lastName: "Staff",
      status: "ACTIVE",
      roles: ["SUPPORT_STAFF"],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing and untrusted Origin headers before exchanging a token", async () => {
    const app = createApp();

    const missingOrigin = await supertest(app)
      .post("/api/v1/staff-auth/invitation/exchange")
      .send({ token: invitationToken });
    const untrustedOrigin = await supertest(app)
      .post("/api/v1/staff-auth/invitation/exchange")
      .set("Origin", "https://attacker.example")
      .send({ token: invitationToken });

    expect(missingOrigin.status).toBe(403);
    expect(untrustedOrigin.status).toBe(403);
    expectNoStoreHeaders(missingOrigin);
    expectNoStoreHeaders(untrustedOrigin);
    expect(mocks.exchangeStaffInvitationToken).not.toHaveBeenCalled();
  });

  it("requires the expected Origin on acceptance as well as exchange", async () => {
    const response = await supertest(createApp())
      .post("/api/v1/staff-auth/accept-invitation")
      .set("Origin", "https://attacker.example")
      .set("Cookie", "staff_invitation_session=session-secret")
      .send(validAcceptance);

    expect(response.status).toBe(403);
    expectNoStoreHeaders(response);
    expect(mocks.acceptStaffInvitation).not.toHaveBeenCalled();
  });

  it("sets a short-lived HttpOnly, Secure, SameSite cookie scoped to the staff-auth API in production", async () => {
    mocks.env.NODE_ENV = "production";
    mocks.env.COOKIE_SAME_SITE = "strict";

    const response = await supertest(createApp())
      .post("/api/v1/staff-auth/invitation/exchange")
      .set("Origin", expectedOrigin)
      .send({ token: invitationToken });

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    const cookies = response.headers["set-cookie"] as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("staff_invitation_session=opaque-session-secret");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[0]).toContain("Path=/api/v1/staff-auth");
    expect(cookies[0]).toContain("Expires=");
    expect(JSON.stringify(response.body)).not.toContain("opaque-session-secret");
  });

  it("does not accept an invitation without the scoped session cookie", async () => {
    const response = await supertest(createApp())
      .post("/api/v1/staff-auth/accept-invitation")
      .set("Origin", expectedOrigin)
      .send(validAcceptance);

    expect(response.status).toBe(400);
    expectNoStoreHeaders(response);
    expect(mocks.acceptStaffInvitation).not.toHaveBeenCalled();
  });

  it("consumes the session and clears the Secure, HttpOnly cookie after successful acceptance", async () => {
    mocks.env.NODE_ENV = "production";
    mocks.env.COOKIE_SAME_SITE = "strict";

    const response = await supertest(createApp())
      .post("/api/v1/staff-auth/accept-invitation")
      .set("Origin", expectedOrigin)
      .set("Cookie", "staff_invitation_session=opaque-session-secret")
      .send(validAcceptance);

    expect(response.status).toBe(201);
    expectNoStoreHeaders(response);
    expect(mocks.acceptStaffInvitation).toHaveBeenCalledWith({
      ...validAcceptance,
      sessionToken: "opaque-session-secret",
    });
    const cookies = response.headers["set-cookie"] as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("staff_invitation_session=;");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[0]).toContain("Path=/api/v1/staff-auth");
    expect(cookies[0]).toMatch(/Expires=.*1970/);
  });

  it("shares the registration rate limit across exchange and acceptance endpoints", async () => {
    const app = createApp();
    const clientIp = "198.51.100.27";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await supertest(app)
        .post("/api/v1/staff-auth/invitation/exchange")
        .set("Origin", expectedOrigin)
        .set("X-Forwarded-For", clientIp)
        .send({});
      expect(response.status).toBe(400);
      expectNoStoreHeaders(response);
    }

    const limitedAcceptance = await supertest(app)
      .post("/api/v1/staff-auth/accept-invitation")
      .set("Origin", expectedOrigin)
      .set("X-Forwarded-For", clientIp)
      .set("Cookie", "staff_invitation_session=session-secret")
      .send(validAcceptance);

    expect(limitedAcceptance.status).toBe(429);
    expect(mocks.exchangeStaffInvitationToken).not.toHaveBeenCalled();
    expect(mocks.acceptStaffInvitation).not.toHaveBeenCalled();
  });
});
