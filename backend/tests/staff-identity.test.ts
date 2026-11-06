import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../src/common/middleware/authenticate";
import { requireCustomer, requireStaff } from "../src/common/middleware/identity";
import {
  acceptStaffInvitationSchema,
  staffInvitationSchema,
} from "../src/modules/staff/staff.validation";

function request(identityType: "CUSTOMER" | "STAFF"): AuthenticatedRequest {
  return {
    user: { id: "00000000-0000-4000-8000-000000000001", identityType, roles: [], permissions: [] },
  } as AuthenticatedRequest;
}

const response = {} as Response;

describe("separate customer and staff identity middleware", () => {
  it("allows customer identity through customer-only routes", () => {
    const next = vi.fn();
    requireCustomer(request("CUSTOMER"), response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects staff identity from customer-only routes", () => {
    const next = vi.fn();
    requireCustomer(request("STAFF"), response, next);
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

  it("requires a strong password when accepting an invitation", () => {
    const base = {
      token: "a".repeat(64),
      firstName: "Taylor",
      lastName: "Staff",
    };
    expect(acceptStaffInvitationSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(acceptStaffInvitationSchema.safeParse({ ...base, password: "A-strong-password-2026" }).success).toBe(true);
  });
});
