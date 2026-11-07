import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashRefreshToken } from "../src/common/utils/refreshToken";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (new URL(databaseUrl).pathname !== "/shop_db_test") {
  throw new Error("Staff invitation tests may only use shop_db_test");
}
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const suffix = randomUUID();
const actorId = randomUUID();
const actorRoleId = randomUUID();
const roleAId = randomUUID();
const roleBId = randomUUID();
const staffManagePermissionId = randomUUID();
const actorEmail = `invitation-admin-${suffix}@test.local`;
const actorRoleName = `TEST_INVITATION_ADMIN_${suffix.replaceAll("-", "").toUpperCase()}`;
const roleAName = `TEST_INVITATION_ROLE_A_${suffix.replaceAll("-", "").toUpperCase()}`;
const roleBName = `TEST_INVITATION_ROLE_B_${suffix.replaceAll("-", "").toUpperCase()}`;
const invitationIds: string[] = [];
const acceptedStaffIds: string[] = [];
const auxiliaryStaffIds: string[] = [];

const [{ default: prisma, disconnectDatabase }, staffService] = await Promise.all([
  import("../src/infrastructure/prisma/client"),
  import("../src/modules/staff/staff.service"),
]);

const {
  acceptStaffInvitation,
  createStaffInvitation,
  listStaffInvitations,
  resendStaffInvitation,
  revokeStaffInvitation,
  updateStaffAccountRoles,
  updateStaffAccountStatus,
  updateStaffInvitationRoles,
} = staffService;

async function createInvitation(email: string, roleIds = [roleAId]) {
  const result = await createStaffInvitation(
    actorId,
    { email, roleIds },
    { ipAddress: "127.0.0.1", userAgent: "staff-invitation-integration-test" },
  );
  invitationIds.push(result.invitation.id);
  return result;
}

describe("PostgreSQL staff invitation lifecycle", () => {
  beforeAll(async () => {
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "shop_db_test") {
      throw new Error("Safety check failed: connected to the wrong database");
    }

    await pool.query(
      `INSERT INTO permissions (id, name, "createdAt")
       VALUES ($1, 'staff.manage', NOW())
       ON CONFLICT (name) DO NOTHING`,
      [staffManagePermissionId],
    );
    const permission = await pool.query(
      `SELECT id FROM permissions WHERE name = 'staff.manage'`,
    );
    const permissionId = permission.rows[0]?.id as string | undefined;
    if (!permissionId) throw new Error("staff.manage permission was not available");

    await pool.query(
      `INSERT INTO roles (id, name, "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW()), ($3, $4, NOW(), NOW()), ($5, $6, NOW(), NOW())`,
      [actorRoleId, actorRoleName, roleAId, roleAName, roleBId, roleBName],
    );
    await pool.query(
      `INSERT INTO role_permissions (id, "roleId", "permissionId", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), actorRoleId, permissionId],
    );
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Invitation', 'Administrator', 'ACTIVE', NOW(), NOW())`,
      [actorId, actorEmail],
    );
    await pool.query(
      `INSERT INTO staff_account_roles (id, "staffAccountId", "roleId", "assignedAt")
       VALUES ($1, $2, $3, NOW())`,
      [randomUUID(), actorId, actorRoleId],
    );
  });

  afterAll(async () => {
    const staffIds = [actorId, ...acceptedStaffIds, ...auxiliaryStaffIds];
    await pool.query(
      `DELETE FROM audit_logs
       WHERE "staffAccountId" = ANY($1::uuid[])
          OR "entityId" = ANY($2::text[])`,
      [staffIds, invitationIds],
    );
    await pool.query(
      `DELETE FROM staff_invitations WHERE id = ANY($1::uuid[])`,
      [invitationIds],
    );
    await pool.query(
      `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
      [staffIds],
    );
    await pool.query(
      `DELETE FROM roles WHERE id = ANY($1::uuid[])`,
      [[actorRoleId, roleAId, roleBId]],
    );
    await disconnectDatabase();
    await pool.end();
  });

  it("creates a normalized invitation, stores only the token hash, and rejects duplicate pending invitations", async () => {
    const rawEmail = `  New.Staff.${suffix}@Example.COM  `;
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const created = await createInvitation(rawEmail, [roleAId, roleBId]);

    expect(created.invitation.email).toBe(normalizedEmail);
    expect(created.invitation.status).toBe("PENDING");
    expect(created.invitation.roles.map(({ role }) => role.id).sort()).toEqual(
      [roleAId, roleBId].sort(),
    );
    expect(created.invitation).not.toHaveProperty("tokenHash");
    expect(created.invitationToken).toMatch(/^[a-f0-9]{64}$/);

    const stored = await pool.query(
      `SELECT "tokenHash", status FROM staff_invitations WHERE id = $1`,
      [created.invitation.id],
    );
    expect(stored.rows[0].tokenHash).toBe(hashRefreshToken(created.invitationToken));
    expect(stored.rows[0].tokenHash).not.toBe(created.invitationToken);
    expect(stored.rows[0].status).toBe("PENDING");

    const audit = await pool.query(
      `SELECT action, "staffAccountId", "entityId"
       FROM audit_logs
       WHERE entity = 'StaffInvitation' AND "entityId" = $1`,
      [created.invitation.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "STAFF_INVITATION_CREATED",
      staffAccountId: actorId,
      entityId: created.invitation.id,
    });

    await expect(
      createInvitation(normalizedEmail, [roleAId]),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("updates pending roles, rotates the token on resend, accepts the latest roles, and prevents replay", async () => {
    const created = await createInvitation(`accept-${suffix}@test.local`);
    const originalToken = created.invitationToken;

    const updated = await updateStaffInvitationRoles(
      actorId,
      created.invitation.id,
      [roleBId],
      { userAgent: "staff-invitation-integration-test" },
    );
    expect(updated.roles.map(({ role }) => role.id)).toEqual([roleBId]);

    const resent = await resendStaffInvitation(actorId, created.invitation.id);
    expect(resent.invitationToken).not.toBe(originalToken);
    expect(resent.invitation).not.toHaveProperty("tokenHash");
    expect(resent.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await expect(
      acceptStaffInvitation({
        token: originalToken,
        password: "A-strong-staff-password-2026",
        firstName: "Taylor",
        lastName: "OldToken",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const staff = await acceptStaffInvitation({
      token: resent.invitationToken,
      password: "A-strong-staff-password-2026",
      firstName: "Taylor",
      lastName: "Staff",
    });
    acceptedStaffIds.push(staff.id);

    expect(staff).toMatchObject({
      email: `accept-${suffix}@test.local`,
      firstName: "Taylor",
      lastName: "Staff",
      status: "ACTIVE",
      roles: [roleBName],
    });

    const persisted = await pool.query(
      `SELECT s.status, s."passwordHash", r.name AS role_name,
              sar."assignedByStaffAccountId", i.status AS invitation_status,
              i."acceptedAt"
       FROM staff_accounts s
       JOIN staff_account_roles sar ON sar."staffAccountId" = s.id
       JOIN roles r ON r.id = sar."roleId"
       JOIN staff_invitations i ON i.id = $2
       WHERE s.id = $1`,
      [staff.id, created.invitation.id],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      status: "ACTIVE",
      role_name: roleBName,
      assignedByStaffAccountId: actorId,
      invitation_status: "ACCEPTED",
    });
    expect(persisted.rows[0].passwordHash).toBeTruthy();
    expect(persisted.rows[0].acceptedAt).toBeTruthy();

    const acceptanceAudit = await pool.query(
      `SELECT action, "staffAccountId"
       FROM audit_logs
       WHERE entity = 'StaffInvitation' AND "entityId" = $1
         AND action = 'STAFF_INVITATION_ACCEPTED'`,
      [created.invitation.id],
    );
    expect(acceptanceAudit.rows).toEqual([
      { action: "STAFF_INVITATION_ACCEPTED", staffAccountId: staff.id },
    ]);

    await expect(
      acceptStaffInvitation({
        token: resent.invitationToken,
        password: "Another-strong-password-2026",
        firstName: "Taylor",
        lastName: "Replay",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("revokes a pending invitation and rejects its token", async () => {
    const created = await createInvitation(`revoke-${suffix}@test.local`);
    const revoked = await revokeStaffInvitation(actorId, created.invitation.id);

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).toBeTruthy();

    await expect(
      acceptStaffInvitation({
        token: created.invitationToken,
        password: "A-strong-staff-password-2026",
        firstName: "Revoked",
        lastName: "Invite",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const audit = await pool.query(
      `SELECT action FROM audit_logs
       WHERE entity = 'StaffInvitation' AND "entityId" = $1
       ORDER BY "createdAt" ASC`,
      [created.invitation.id],
    );
    expect(audit.rows.map(({ action }) => action)).toContain("STAFF_INVITATION_REVOKED");
  });

  it("marks expired invitations as EXPIRED and rejects acceptance", async () => {
    const created = await createInvitation(`expired-${suffix}@test.local`);
    const forcedExpiry = new Date(Date.now() - 60_000);
    const expiryUpdate = await pool.query(
      `UPDATE staff_invitations
       SET "expiresAt" = $1
       WHERE id = $2
       RETURNING status, "expiresAt", NOW() AS database_now`,
      [forcedExpiry, created.invitation.id],
    );
    expect(expiryUpdate.rowCount).toBe(1);
    expect(new Date(expiryUpdate.rows[0].expiresAt).getTime()).toBeLessThan(
      new Date(expiryUpdate.rows[0].database_now).getTime(),
    );

    const listed = await listStaffInvitations();
    const storedAfterList = await prisma.staffInvitation.findUnique({
      where: { id: created.invitation.id },
      select: { status: true, updatedAt: true },
    });
    expect(storedAfterList?.status).toBe("EXPIRED");
    const expired = listed.find(({ id }) => id === created.invitation.id);
    expect(expired?.status).toBe("EXPIRED");

    await expect(
      acceptStaffInvitation({
        token: created.invitationToken,
        password: "A-strong-staff-password-2026",
        firstName: "Expired",
        lastName: "Invite",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows only one concurrent acceptance of the same invitation", async () => {
    const created = await createInvitation(`concurrent-${suffix}@test.local`);
    const attempts = await Promise.allSettled([
      acceptStaffInvitation({
        token: created.invitationToken,
        password: "A-strong-staff-password-2026",
        firstName: "Concurrent",
        lastName: "Winner",
      }),
      acceptStaffInvitation({
        token: created.invitationToken,
        password: "Another-strong-password-2026",
        firstName: "Concurrent",
        lastName: "Loser",
      }),
    ]);

    const successful = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof acceptStaffInvitation>>> =>
        attempt.status === "fulfilled",
    );
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    acceptedStaffIds.push(successful[0].value.id);

    const invitation = await pool.query(
      `SELECT status, "acceptedAt" FROM staff_invitations WHERE id = $1`,
      [created.invitation.id],
    );
    expect(invitation.rows[0]).toMatchObject({ status: "ACCEPTED" });
    expect(invitation.rows[0].acceptedAt).toBeTruthy();

    const staffForEmail = await pool.query(
      `SELECT id FROM staff_accounts WHERE email = $1`,
      [`concurrent-${suffix}@test.local`],
    );
    expect(staffForEmail.rows).toHaveLength(1);
  });

  it("does not reactivate a staff account without an assigned role", async () => {
    const staffId = randomUUID();
    auxiliaryStaffIds.push(staffId);
    await pool.query(
      `INSERT INTO staff_accounts
       (id, email, "firstName", "lastName", status, "createdAt", "updatedAt")
       VALUES ($1, $2, 'No', 'Roles', 'SUSPENDED', NOW(), NOW())`,
      [staffId, `no-roles-${suffix}@test.local`],
    );

    await expect(
      updateStaffAccountStatus(actorId, staffId, "ACTIVE"),
    ).rejects.toMatchObject({ statusCode: 409 });

    const persisted = await pool.query(
      `SELECT status FROM staff_accounts WHERE id = $1`,
      [staffId],
    );
    expect(persisted.rows[0]?.status).toBe("SUSPENDED");
  });

  it("rechecks current delegation permissions inside the staff-role transaction", async () => {
    const staffId = auxiliaryStaffIds[0];
    if (!staffId) throw new Error("The no-role staff fixture was not created");

    // Revoke the actor's staff.manage role immediately before the service call.
    await pool.query(
      `DELETE FROM staff_account_roles WHERE "staffAccountId" = $1`,
      [actorId],
    );

    await expect(
      updateStaffAccountRoles(actorId, staffId, [roleAId]),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

});
