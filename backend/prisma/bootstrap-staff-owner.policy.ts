export interface PendingStaffAccount {
  status: string;
  passwordHash: string | null;
  roles: Array<{ role: { name: string } }>;
}

export function assertNoActiveStaff(activeStaffCount: number): void {
  if (activeStaffCount > 0) {
    throw new Error(
      "An active staff account already exists. Bootstrap is only allowed before staff activation.",
    );
  }
}

export function assertPendingOwnerAccount(
  existing: PendingStaffAccount | null,
): void {
  if (!existing) return;

  if (existing.status !== "PENDING_SETUP" || existing.passwordHash) {
    throw new Error(
      "An account already exists for this email and is not an uninitialized pending account. Bootstrap cannot modify it.",
    );
  }

  if (existing.roles.some(({ role }) => role.name !== "BUSINESS_OWNER")) {
    throw new Error(
      "The pending account has unexpected role assignments. Review them before bootstrapping.",
    );
  }
}
