import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../src/infrastructure/prisma/client";
import {
  authenticate,
  type AuthenticatedRequest,
} from "../src/common/middleware/authenticate";
import { authorize } from "../src/common/middleware/authorize";

const response = {} as Response;
const validPayload = {
  sub: "00000000-0000-4000-8000-000000000001",
  identityType: "STAFF",
  roles: ["OPERATIONS"],
  permissions: ["orders.manage"],
  iat: 1_800_000_000,
  exp: 1_800_000_900,
};

function request(authorization?: string): AuthenticatedRequest {
  return {
    headers: authorization ? { authorization } : {},
  } as AuthenticatedRequest;
}

function staffRequest(): AuthenticatedRequest {
  return {
    user: {
      id: validPayload.sub,
      identityType: "STAFF",
      roles: ["STALE_ROLE"],
      permissions: ["stale.permission"],
    },
  } as AuthenticatedRequest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JWT authentication middleware", () => {
  it("rejects a missing Authorization header", () => {
    const next = vi.fn<NextFunction>();
    authenticate(request(), response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects malformed Bearer headers before verifying a token", () => {
    const verify = vi.spyOn(jwt, "verify");
    const next = vi.fn<NextFunction>();

    authenticate(request("Bearer token extra"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
    expect(verify).not.toHaveBeenCalled();
  });

  it("restricts verification to HS256 and accepts a valid staff token", () => {
    const verify = vi.spyOn(jwt, "verify").mockReturnValue(validPayload as never);
    const req = request("Bearer valid-token");
    const next = vi.fn<NextFunction>();

    authenticate(req, response, next);

    expect(verify).toHaveBeenCalledWith("valid-token", expect.any(String), {
      algorithms: ["HS256"],
    });
    expect(req.user).toEqual({
      id: validPayload.sub,
      identityType: "STAFF",
      roles: ["OPERATIONS"],
      permissions: ["orders.manage"],
      sessionVersion: 0,
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects tokens without an expiry claim", () => {
    vi.spyOn(jwt, "verify").mockReturnValue({
      ...validPayload,
      exp: undefined,
    } as never);
    const next = vi.fn<NextFunction>();

    authenticate(request("Bearer token"), response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects malformed role or permission claims instead of silently filtering them", () => {
    vi.spyOn(jwt, "verify").mockReturnValue({
      ...validPayload,
      roles: ["OPERATIONS", 42],
    } as never);
    const next = vi.fn<NextFunction>();

    authenticate(request("Bearer token"), response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects invalid or expired signatures", () => {
    vi.spyOn(jwt, "verify").mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const next = vi.fn<NextFunction>();

    authenticate(request("Bearer token"), response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });

  it("treats legacy tokens without identityType as customer tokens", () => {
    vi.spyOn(jwt, "verify").mockReturnValue({
      ...validPayload,
      identityType: undefined,
    } as never);
    const req = request("Bearer legacy-token");
    const next = vi.fn<NextFunction>();

    authenticate(req, response, next);

    expect(req.user?.identityType).toBe("CUSTOMER");
    expect(next).toHaveBeenCalledWith();
  });
});

describe("staff authorization middleware", () => {
  it("rejects unauthenticated requests", async () => {
    const next = vi.fn<NextFunction>();
    await authorize("orders.manage")({} as AuthenticatedRequest, response, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects customer tokens without querying staff accounts", async () => {
    const lookup = vi.spyOn(prisma.staffAccount, "findUnique");
    const next = vi.fn<NextFunction>();
    await authorize("orders.manage")({
      user: { id: validPayload.sub, identityType: "CUSTOMER", roles: [], permissions: [] },
    } as AuthenticatedRequest, response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses current database permissions rather than stale JWT permissions", async () => {
    vi.spyOn(prisma.staffAccount, "findUnique").mockResolvedValue({
      status: "ACTIVE",
      roles: [{
        role: {
          name: "OPERATIONS",
          permissions: [{ permission: { name: "orders.manage" } }],
        },
      }],
    } as never);
    const req = staffRequest();
    const next = vi.fn<NextFunction>();

    await authorize("orders.manage")(req, response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user?.roles).toEqual(["OPERATIONS"]);
    expect(req.user?.permissions).toEqual(["orders.manage"]);
  });

  it("combines permissions from every assigned staff role", async () => {
    vi.spyOn(prisma.staffAccount, "findUnique").mockResolvedValue({
      status: "ACTIVE",
      roles: [
        {
          role: {
            name: "SUPPORT_STAFF",
            permissions: [
              { permission: { name: "returns.manage" } },
              { permission: { name: "refunds.manage" } },
            ],
          },
        },
        {
          role: {
            name: "ORDER_OPERATOR",
            permissions: [
              { permission: { name: "orders.manage" } },
              { permission: { name: "fulfillment.manage" } },
            ],
          },
        },
      ],
    } as never);
    const req = staffRequest();
    const next = vi.fn<NextFunction>();

    await authorize("refunds.manage")(req, response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user?.roles).toEqual(["SUPPORT_STAFF", "ORDER_OPERATOR"]);
    expect(req.user?.permissions).toEqual([
      "returns.manage",
      "refunds.manage",
      "orders.manage",
      "fulfillment.manage",
    ]);
  });

  it("rejects a permission removed from the current database roles", async () => {
    vi.spyOn(prisma.staffAccount, "findUnique").mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { name: "OPERATIONS", permissions: [] } }],
    } as never);
    const next = vi.fn<NextFunction>();

    await authorize("orders.manage")(staffRequest(), response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("rejects inactive staff accounts", async () => {
    vi.spyOn(prisma.staffAccount, "findUnique").mockResolvedValue({
      status: "SUSPENDED",
      roles: [],
    } as never);
    const next = vi.fn<NextFunction>();

    await authorize("orders.manage")(staffRequest(), response, next);

    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("passes database failures to the error handler", async () => {
    const databaseError = new Error("database unavailable");
    vi.spyOn(prisma.staffAccount, "findUnique").mockRejectedValue(databaseError);
    const next = vi.fn<NextFunction>();

    await authorize("orders.manage")(staffRequest(), response, next);

    expect(next).toHaveBeenCalledWith(databaseError);
  });
});
