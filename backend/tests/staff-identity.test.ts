import { afterEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../src/common/middleware/authenticate";
import prisma from "../src/infrastructure/prisma/client";
import { requireCustomer, requireStaff } from "../src/common/middleware/identity";
import {
  completeStaffInvitationSchema,
  exchangeStaffInvitationSchema,
  staffInvitationSchema,
} from "../src/modules/staff/staff.validation";

function request(identityType: "CUSTOMER" | "STAFF"): AuthenticatedRequest {
  return {
    user: { id: "00000000-0000-4000-8000-000000000001", identityType, roles: [], permissions: [] },
  } as AuthenticatedRequest;
}

const response = {} as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("separate customer and staff identity middleware", () => {
  it("allows an active database-backed customer identity", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 0,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    } as never);
    const req = request("CUSTOMER");
    const next = vi.fn();

    await requireCustomer(req, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(req.user?.roles).toEqual(["CUSTOMER"]);
  });

  it("rejects staff identity from customer-only routes without querying customers", async () => {
    const lookup = vi.spyOn(prisma.user, "findUnique");
    const next = vi.fn();

    await requireCustomer(request("STAFF"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects inactive customer accounts", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      isActive: false,
      sessionVersion: 0,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    } as never);
    const next = vi.fn();

    await requireCustomer(request("CUSTOMER"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("rejects unverified customer accounts from protected routes", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      isActive: true,
      emailVerified: false,
      sessionVersion: 0,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    } as never);
    const next = vi.fn();

    await requireCustomer(request("CUSTOMER"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("rejects legacy staff-only accounts whose token has no current customer role", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 0,
      userRoles: [{ role: { name: "SUPPORT_STAFF" } }],
    } as never);
    const next = vi.fn();

    await requireCustomer(request("CUSTOMER"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("rejects access tokens issued before a customer password reset", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 1,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    } as never);
    const req = request("CUSTOMER");
    req.user!.sessionVersion = 0;
    const next = vi.fn();

    await requireCustomer(req, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("rejects missing customer records", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
    const next = vi.fn();

    await requireCustomer(request("CUSTOMER"), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it("allows staff identity through staff-only routes", () => {
    const next = vi.fn();
    requireStaff(request("STAFF"), response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects customer identity from staff-only routes", () => {
    const next = vi.fn();
    requireStaff(request("CUSTOMER"), response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });
});

describe("staff invitation validation", () => {
  it("normalizes invitation email and supports multiple roles", () => {
    const parsed = staffInvitationSchema.safeParse({
      email: " STAFF@Example.COM ",
      roleIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe("staff@example.com");
  });

  it("rejects invitations without an assigned role", () => {
    expect(staffInvitationSchema.safeParse({
      email: "staff@example.com",
      roleIds: [],
    }).success).toBe(false);
  });

  it("validates invitation token exchange and requires a strong password for account completion", () => {
    const token = "a".repeat(64);
    expect(exchangeStaffInvitationSchema.safeParse({ token }).success).toBe(true);
    expect(exchangeStaffInvitationSchema.safeParse({ token: "short" }).success).toBe(false);

    const base = {
      firstName: "Taylor",
      lastName: "Staff",
    };
    expect(completeStaffInvitationSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(completeStaffInvitationSchema.safeParse({
      ...base,
      password: "A-strong-password-2026",
    }).success).toBe(true);
  });
});
