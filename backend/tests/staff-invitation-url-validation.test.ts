import { describe, expect, it } from "vitest";
import { isValidStaffInvitationAcceptanceUrl } from "../src/config/url-validation";

describe("staff invitation acceptance URL validation", () => {
  it("allows HTTP and HTTPS outside production", () => {
    expect(isValidStaffInvitationAcceptanceUrl(
      "http://localhost:3000/staff/accept-invitation", "development",
    )).toBe(true);
    expect(isValidStaffInvitationAcceptanceUrl(
      "https://clickclickbuy.ng/staff/accept-invitation", "test",
    )).toBe(true);
  });

  it("requires HTTPS in production", () => {
    expect(isValidStaffInvitationAcceptanceUrl(
      "http://clickclickbuy.ng/staff/accept-invitation", "production",
    )).toBe(false);
    expect(isValidStaffInvitationAcceptanceUrl(
      "https://clickclickbuy.ng/staff/accept-invitation", "production",
    )).toBe(true);
  });

  it("rejects unsupported protocols and URL components in every environment", () => {
    for (const environment of ["development", "test", "production"]) {
      expect(isValidStaffInvitationAcceptanceUrl(
        "ftp://clickclickbuy.ng/staff/accept-invitation", environment,
      )).toBe(false);
      expect(isValidStaffInvitationAcceptanceUrl(
        "javascript:alert(1)", environment,
      )).toBe(false);
      expect(isValidStaffInvitationAcceptanceUrl(
        "https://user:pass@clickclickbuy.ng/staff/accept-invitation", environment,
      )).toBe(false);
      expect(isValidStaffInvitationAcceptanceUrl(
        "https://clickclickbuy.ng/staff/accept-invitation?token=secret", environment,
      )).toBe(false);
      expect(isValidStaffInvitationAcceptanceUrl(
        "https://clickclickbuy.ng/staff/accept-invitation#token=secret", environment,
      )).toBe(false);
    }
  });
});
