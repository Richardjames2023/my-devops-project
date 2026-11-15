import { describe, expect, it } from "vitest";
import {
  assertNoActiveStaff,
  assertPendingOwnerAccount,
} from "../prisma/bootstrap-staff-owner.policy";

describe("initial staff owner bootstrap safeguards", () => {
  it("allows bootstrap only while there are no active staff accounts", () => {
    expect(() => assertNoActiveStaff(0)).not.toThrow();
    expect(() => assertNoActiveStaff(1)).toThrow(
      "An active staff account already exists",
    );
  });

  it("allows activation of an uninitialized pending owner account", () => {
    expect(() =>
      assertPendingOwnerAccount({
        status: "PENDING_SETUP",
        passwordHash: null,
        roles: [{ role: { name: "BUSINESS_OWNER" } }],
      }),
    ).not.toThrow();
  });

  it("allows creating a new owner when no account exists for the email", () => {
    expect(() => assertPendingOwnerAccount(null)).not.toThrow();
  });

  it.each([
    {
      status: "ACTIVE",
      passwordHash: null,
      roles: [{ role: { name: "BUSINESS_OWNER" } }],
    },
    {
      status: "PENDING_SETUP",
      passwordHash: "already-hashed",
      roles: [{ role: { name: "BUSINESS_OWNER" } }],
    },
  ])("refuses to modify an account that is not uninitialized pending setup", (account) => {
    expect(() => assertPendingOwnerAccount(account)).toThrow(
      "not an uninitialized pending account",
    );
  });

  it("refuses pending accounts with unexpected role assignments", () => {
    expect(() =>
      assertPendingOwnerAccount({
        status: "PENDING_SETUP",
        passwordHash: null,
        roles: [{ role: { name: "INVENTORY_MANAGER" } }],
      }),
    ).toThrow("unexpected role assignments");
  });
});
