import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { hashPassword, verifyPassword } from "../../common/utils/password";
import { generateAccessToken } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS } from "../../config/auth";
import { createAuditLog } from "../../common/utils/audit-log";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";
import { env } from "../../config/env";
import { isValidStaffInvitationAcceptanceUrl } from "../../config/url-validation";
import { encryptInvitationSecret, getInvitationEncryptionKeyring } from "./staff-invitation-encryption";

const invitationDaysMax = 30;

type RequestMetadata = { ipAddress?: string; userAgent?: string };

function expiryFromDays(days: number): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function invitationExpiryFromDays(
  tx: Prisma.TransactionClient,
  days: number,
): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
    SELECT NOW() + (${days} * INTERVAL '1 day') AS "expiresAt"
  `;
  if (!row?.expiresAt) throw new Error("Could not calculate invitation expiry");
  return row.expiresAt;
}

async function invitationExpiryFromHours(
  tx: Prisma.TransactionClient,
  hours: number,
): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
    SELECT NOW() + (${hours} * INTERVAL '1 hour') AS "expiresAt"
  `;
  if (!row?.expiresAt) throw new Error("Could not calculate invitation expiry");
  return row.expiresAt;
}

async function getStaffManagerContext(
  tx: Prisma.TransactionClient,
  actorId: string,
  additionalStaffIds: string[] = [],
) {
  // Serialize permission-sensitive mutations with role and status changes.
  const lockIds = [...new Set([actorId, ...additionalStaffIds])].sort();
  await tx.$queryRaw`SELECT id FROM staff_accounts
    WHERE id = ANY(${lockIds}::uuid[])
    ORDER BY id
    FOR UPDATE`;

  const actor = await tx.staffAccount.findUnique({
    where: { id: actorId },
    select: {
      status: true,
      roles: {
        select: {
          role: {
            select: {
              name: true,
              permissions: { select: { permission: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  if (!actor || actor.status !== "ACTIVE") {
    throw new AppError("Active staff account required", 403);
  }

  const actorRoleNames = actor.roles.map(({ role }) => role.name);
  const actorPermissions = new Set(actor.roles.flatMap(({ role }) =>
    role.permissions.map(({ permission }) => permission.name),
  ));
  if (!actorPermissions.has("staff.manage")) {
    throw new AppError("You do not have permission to manage staff roles", 403);
  }

  return { actorRoleNames, actorPermissions };
}

async function getDelegableRoles(
  tx: Prisma.TransactionClient,
  actorId: string,
  roleIds: string[],
  additionalStaffIds: string[] = [],
) {
  if (new Set(roleIds).size !== roleIds.length) {
    throw new AppError("Duplicate staff roles are not allowed", 400);
  }

  const { actorRoleNames, actorPermissions } = await getStaffManagerContext(
    tx,
    actorId,
    additionalStaffIds,
  );
  const isBusinessOwner = actorRoleNames.includes("BUSINESS_OWNER");

  const roles = await tx.role.findMany({
    where: { id: { in: roleIds } },
    select: {
      id: true,
      name: true,
      permissions: { select: { permission: { select: { name: true } } } },
    },
  });

  if (roles.length !== new Set(roleIds).size) {
    throw new AppError("One or more selected roles do not exist", 400);
  }

  for (const role of roles) {
    if (role.name === "CUSTOMER") {
      throw new AppError("Customer is not a staff role", 400);
    }
    if (role.name === "BUSINESS_OWNER" && !isBusinessOwner) {
      throw new AppError("Only a business owner can delegate the BUSINESS_OWNER role", 403);
    }
    if (!isBusinessOwner && role.permissions.some(({ permission }) => !actorPermissions.has(permission.name))) {
      throw new AppError(`You are not authorized to delegate the ${role.name} role`, 403);
    }
  }

  return { roles, actorRoleNames };
}

async function queueStaffInvitationEmail(
  tx: Prisma.TransactionClient,
  input: { invitationId: string; email: string; token: string; tokenHash: string },
) {
  if (!env.STAFF_INVITATION_ENCRYPTION_KEY && !env.STAFF_INVITATION_ENCRYPTION_KEYRING) {
    throw new AppError("Staff invitation email encryption is not configured", 503);
  }
  const configuredUrl = env.STAFF_INVITATION_ACCEPTANCE_URL ??
    (env.APP_BASE_URL ? new URL("/staff/accept-invitation", env.APP_BASE_URL).toString() : undefined);
  if (!configuredUrl) {
    throw new AppError("Staff invitation acceptance URL is not configured", 503);
  }
  const acceptanceUrl = new URL(configuredUrl);
  if (!isValidStaffInvitationAcceptanceUrl(acceptanceUrl.toString(), env.NODE_ENV)) {
    throw new AppError("Staff invitation acceptance URL is invalid", 503);
  }
  const encryptionKeyring = getInvitationEncryptionKeyring(
    env.STAFF_INVITATION_ENCRYPTION_KEY,
    env.STAFF_INVITATION_ENCRYPTION_KEYRING,
    env.STAFF_INVITATION_ENCRYPTION_ACTIVE_KEY_ID,
  );
  const encryptedToken = encryptInvitationSecret(input.token, encryptionKeyring);
  const templateData: Prisma.InputJsonObject = {
    invitationId: input.invitationId,
    encryptedToken: {
      version: encryptedToken.version,
      algorithm: encryptedToken.algorithm,
      keyId: encryptedToken.keyId,
      nonce: encryptedToken.nonce,
      authTag: encryptedToken.authTag,
      ciphertext: encryptedToken.ciphertext,
    },
  };
  const delivery = await tx.notificationEmailDelivery.create({
    data: {
      recipientEmail: input.email,
      templateKey: "staff.invitation",
      templateData,
      eventRecipientKey: `staff-invitation:${input.invitationId}:${input.tokenHash}`,
      status: "QUEUED",
      nextAttemptAt: new Date(),
    },
    select: { id: true, status: true },
  });
  return delivery;
}

async function suppressStaffInvitationDeliveries(
  tx: Prisma.TransactionClient,
  invitationId: string,
) {
  await tx.staffInvitationAcceptanceSession.updateMany({
    where: { invitationId, consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.notificationEmailDelivery.updateMany({
    where: {
      templateKey: "staff.invitation",
      eventRecipientKey: { startsWith: `staff-invitation:${invitationId}:` },
      status: { in: ["QUEUED", "RETRYING", "PROCESSING"] },
    },
    data: {
      status: "SUPPRESSED",
      suppressedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: "Invitation token was rotated or invalidated",
    },
  });
}

export async function createStaffInvitation(
  actorId: string,
  input: { email: string; roleIds: string[]; expiresInDays?: number | undefined },
  metadata: RequestMetadata = {},
) {
  const email = normalizeEmail(input.email);
  if (input.expiresInDays !== undefined &&
      (input.expiresInDays < 1 || input.expiresInDays > invitationDaysMax)) {
    throw new AppError(`Invitation expiry must be between 1 and ${invitationDaysMax} days`, 400);
  }
  if (!input.roleIds.length) throw new AppError("At least one staff role is required", 400);

  const token = crypto.randomBytes(32).toString("hex");
  const invitation = await prisma.$transaction(async (tx) => {
    // Delegation permissions are checked inside this transaction against the
    // current staff account and role assignments.
    const { roles } = await getDelegableRoles(tx, actorId, input.roleIds);

    // Serialize invitation creation for the same normalized email address.
    // The pending-invitation check alone is not safe under concurrent requests:
    // two transactions could both observe no pending row before either inserts.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))
    `;

    await tx.$executeRaw`
      UPDATE staff_invitations
      SET status = 'EXPIRED', "updatedAt" = NOW()
      WHERE email = ${email}
        AND status = 'PENDING'
        AND "expiresAt" <= NOW()
    `;

    const existingStaff = await tx.staffAccount.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
    if (existingStaff && existingStaff.status !== "PENDING_SETUP") {
      throw new AppError("A staff account already exists for this email address", 409);
    }

    const pending = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM staff_invitations
      WHERE email = ${email}
        AND status = 'PENDING'
        AND "expiresAt" > NOW()
      LIMIT 1
    `;
    if (pending.length) {
      throw new AppError("A pending invitation already exists for this email address", 409);
    }

    const expiresAt = input.expiresInDays === undefined
      ? await invitationExpiryFromHours(tx, env.STAFF_INVITATION_TTL_HOURS)
      : await invitationExpiryFromDays(tx, input.expiresInDays);
    const createdBase = await tx.staffInvitation.create({
      data: {
        email,
        tokenHash: hashRefreshToken(token),
        expiresAt,
        createdByStaffAccountId: actorId,
      },
    });
    await tx.staffInvitationRole.createMany({
      data: roles.map((role) => ({ invitationId: createdBase.id, roleId: role.id })),
    });
    const delivery = await queueStaffInvitationEmail(tx, {
      invitationId: createdBase.id,
      email,
      token,
      tokenHash: hashRefreshToken(token),
    });
    const created = await tx.staffInvitation.findUniqueOrThrow({
      where: { id: createdBase.id },
      include: { roles: { include: { role: { select: { id: true, name: true } } } } },
    });
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_INVITATION_CREATED",
      entity: "StaffInvitation",
      entityId: created.id,
      newValues: { email, roleNames: roles.map((role) => role.name), expiresAt: created.expiresAt.toISOString() },
      ...metadata,
    });
    return { invitation: created, delivery };
  });

  const { tokenHash: _tokenHash, ...safeInvitation } = invitation.invitation;
  void _tokenHash;
  return { invitation: safeInvitation, delivery: invitation.delivery };
}

export async function listStaffInvitations() {
  // Use the database clock for expiry decisions so the transition is
  // consistent with PostgreSQL timestamps and is not affected by app-server
  // clock skew or DateTime parameter precision.
  await prisma.$executeRaw`
    UPDATE staff_invitations
    SET status = 'EXPIRED', "updatedAt" = NOW()
    WHERE status = 'PENDING'
      AND "expiresAt" <= NOW()
  `;
  return prisma.staffInvitation.findMany({
    select: {
      id: true, email: true, status: true, expiresAt: true, acceptedAt: true,
      revokedAt: true, createdAt: true, updatedAt: true, createdByStaffAccountId: true,
      roles: { select: { role: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function resendStaffInvitation(
  actorId: string, invitationId: string, metadata: RequestMetadata = {},
) {
  const token = crypto.randomBytes(32).toString("hex");
  const updated = await prisma.$transaction(async (tx) => {
    await getStaffManagerContext(tx, actorId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM staff_invitations
      WHERE id = ${invitationId}::uuid
      FOR UPDATE
    `;
    if (!locked.length) throw new AppError("Staff invitation not found", 404);

    const invitation = await tx.staffInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    const [expiryState] = await tx.$queryRaw<Array<{ isValid: boolean }>>`
      SELECT "expiresAt" > NOW() AS "isValid"
      FROM staff_invitations
      WHERE id = ${invitationId}::uuid
    `;
    if (invitation.status !== "PENDING" || !expiryState?.isValid) {
      throw new AppError("Only unexpired pending invitations can be resent", 409);
    }

    const expiresAt = await invitationExpiryFromHours(tx, env.STAFF_INVITATION_TTL_HOURS);
    const tokenHash = hashRefreshToken(token);
    const result = await tx.staffInvitation.update({
      where: { id: invitationId },
      data: { tokenHash, expiresAt },
    });
    await suppressStaffInvitationDeliveries(tx, invitationId);
    const delivery = await queueStaffInvitationEmail(tx, {
      invitationId,
      email: invitation.email,
      token,
      tokenHash,
    });
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_INVITATION_RESENT",
      entity: "StaffInvitation",
      entityId: invitationId,
      oldValues: { expiresAt: invitation.expiresAt.toISOString() },
      newValues: { expiresAt: result.expiresAt.toISOString() },
      ...metadata,
    });
    return { invitation: result, delivery };
  });
  const { tokenHash: _tokenHash, ...safeInvitation } = updated.invitation;
  void _tokenHash;
  return { invitation: safeInvitation, delivery: updated.delivery };
}

export async function updateStaffInvitationRoles(
  actorId: string,
  invitationId: string,
  roleIds: string[],
  metadata: RequestMetadata = {},
) {
  if (!roleIds.length) throw new AppError("An invitation must contain at least one role", 400);

  return prisma.$transaction(async (tx) => {
    const { roles } = await getDelegableRoles(tx, actorId, roleIds);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM staff_invitations
      WHERE id = ${invitationId}::uuid
      FOR UPDATE
    `;
    if (!locked.length) throw new AppError("Staff invitation not found", 404);

    const invitation = await tx.staffInvitation.findUnique({
      where: { id: invitationId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    const [expiryState] = await tx.$queryRaw<Array<{ isValid: boolean }>>`
      SELECT "expiresAt" > NOW() AS "isValid"
      FROM staff_invitations
      WHERE id = ${invitationId}::uuid
    `;
    if (invitation.status !== "PENDING" || !expiryState?.isValid) {
      throw new AppError("Only unexpired pending invitations can be edited", 409);
    }

    const previousRoles = invitation.roles.map(({ role }) => role.name);
    await tx.staffInvitationRole.deleteMany({ where: { invitationId } });
    await tx.staffInvitationRole.createMany({
      data: roles.map((role) => ({ invitationId, roleId: role.id })),
    });
    const updated = await tx.staffInvitation.findUniqueOrThrow({
      where: { id: invitationId },
      include: { roles: { include: { role: { select: { id: true, name: true } } } } },
    });
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_INVITATION_ROLES_UPDATED",
      entity: "StaffInvitation",
      entityId: invitationId,
      oldValues: { roleNames: previousRoles },
      newValues: { roleNames: roles.map((role) => role.name) },
      ...metadata,
    });
    const { tokenHash: _tokenHash, ...safeUpdated } = updated;
    void _tokenHash;
    return safeUpdated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function revokeStaffInvitation(actorId: string, invitationId: string, metadata: RequestMetadata = {}) {
  return prisma.$transaction(async (tx) => {
    await getStaffManagerContext(tx, actorId);
    await tx.$queryRaw`SELECT id FROM staff_invitations WHERE id = ${invitationId}::uuid FOR UPDATE`;
    const invitation = await tx.staffInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    if (invitation.status !== "PENDING") throw new AppError("Only pending invitations can be revoked", 409);

    const updated = await tx.staffInvitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await suppressStaffInvitationDeliveries(tx, invitationId);
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_INVITATION_REVOKED",
      entity: "StaffInvitation",
      entityId: invitationId,
      oldValues: { status: invitation.status },
      newValues: { status: updated.status },
      ...metadata,
    });
    const { tokenHash: _tokenHash, ...safeUpdated } = updated;
    void _tokenHash;
    return safeUpdated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function exchangeStaffInvitationToken(token: string) {
  const tokenHash = hashRefreshToken(token);
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM staff_invitations
      WHERE "tokenHash" = ${tokenHash}
        AND status = 'PENDING'
        AND "expiresAt" > NOW()
      FOR UPDATE
    `;
    const lockedInvitation = locked[0];
    if (!lockedInvitation) {
      throw new AppError("This staff invitation is invalid or expired", 400);
    }

    await tx.staffInvitationAcceptanceSession.updateMany({
      where: { invitationId: lockedInvitation.id, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const [expiry] = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT NOW() + (${env.STAFF_INVITATION_ACCEPTANCE_SESSION_TTL_MINUTES} * INTERVAL '1 minute') AS "expiresAt"
    `;
    if (!expiry?.expiresAt) throw new Error("Could not calculate invitation session expiry");
    await tx.staffInvitationAcceptanceSession.create({
      data: {
        invitationId: lockedInvitation.id,
        tokenHash: hashRefreshToken(sessionToken),
        expiresAt: expiry.expiresAt,
      },
    });
    return expiry.expiresAt;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { sessionToken, expiresAt };
}

export async function acceptStaffInvitation(input: {
  sessionToken: string; password: string; firstName: string; lastName: string;
}) {
  const sessionHash = hashRefreshToken(input.sessionToken);
  return prisma.$transaction(async (tx) => {
    // The row lock and expiry predicate both use PostgreSQL's clock. A token
    // cannot be accepted based on a skewed application-server clock.
    const locked = await tx.$queryRaw<Array<{ sessionId: string; invitationId: string }>>`
      SELECT session.id AS "sessionId", invitation.id AS "invitationId"
      FROM staff_invitation_acceptance_sessions AS session
      JOIN staff_invitations AS invitation ON invitation.id = session."invitationId"
      WHERE session."tokenHash" = ${sessionHash}
        AND session."consumedAt" IS NULL
        AND session."revokedAt" IS NULL
        AND session."expiresAt" > NOW()
        AND invitation.status = 'PENDING'
        AND invitation."expiresAt" > NOW()
      FOR UPDATE OF session, invitation
    `;
    const lockedSession = locked[0];
    if (!lockedSession) {
      throw new AppError("This staff invitation session is invalid or expired", 400);
    }

    const invitation = await tx.staffInvitation.findUnique({
      where: { id: lockedSession.invitationId },
      include: { roles: { select: { roleId: true, role: { select: { name: true } } } } },
    });
    if (!invitation || invitation.status !== "PENDING") {
      throw new AppError("This staff invitation is invalid, expired, or already used", 400);
    }
    if (!invitation.roles.length) throw new AppError("This invitation has no assigned staff roles", 409);

    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE staff_invitations
      SET status = 'ACCEPTED', "acceptedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = ${invitation.id}::uuid
        AND status = 'PENDING'
        AND "expiresAt" > NOW()
      RETURNING id
    `;
    if (claimed.length !== 1) {
      throw new AppError("This staff invitation has already been used", 409);
    }

    const consumedSession = await tx.$executeRaw`
      UPDATE staff_invitation_acceptance_sessions
      SET "consumedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = ${lockedSession.sessionId}::uuid
        AND "tokenHash" = ${sessionHash}
        AND "consumedAt" IS NULL
        AND "revokedAt" IS NULL
        AND "expiresAt" > NOW()
    `;
    if (consumedSession !== 1) {
      throw new AppError("This staff invitation session has already been used", 409);
    }

    const passwordHash = await hashPassword(input.password);
    const existing = await tx.staffAccount.findUnique({ where: { email: invitation.email } });
    if (existing && existing.status !== "PENDING_SETUP") {
      throw new AppError("A staff account already exists for this invitation", 409);
    }

    const staff = existing
      ? await tx.staffAccount.update({
          where: { id: existing.id },
          data: {
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        })
      : await tx.staffAccount.create({
          data: {
            email: invitation.email,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        });

    await tx.staffAccountRole.deleteMany({ where: { staffAccountId: staff.id } });
    await tx.staffAccountRole.createMany({
      data: invitation.roles.map(({ roleId }) => ({
        staffAccountId: staff.id,
        roleId,
        ...(invitation.createdByStaffAccountId ? { assignedByStaffAccountId: invitation.createdByStaffAccountId } : {}),
      })),
    });
    await createAuditLog(tx, {
      staffAccountId: staff.id,
      action: "STAFF_INVITATION_ACCEPTED",
      entity: "StaffInvitation",
      entityId: invitation.id,
      newValues: { staffAccountId: staff.id, roleNames: invitation.roles.map(({ role }) => role.name) },
    });
    return {
      id: staff.id,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      status: staff.status,
      roles: invitation.roles.map(({ role }) => role.name),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function staffAuthContext(staffId: string) {
  const staff = await prisma.staffAccount.findUnique({
    where: { id: staffId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!staff || staff.status !== "ACTIVE" || !staff.passwordHash) {
    throw new AppError("Staff account is inactive", 403);
  }
  const roles = staff.roles.map(({ role }) => role.name);
  const permissions = [...new Set(staff.roles.flatMap(({ role }) =>
    role.permissions.map(({ permission }) => permission.name),
  ))];
  return { staff, roles, permissions };
}

function createStaffTokens(staffId: string, roles: string[], permissions: string[]) {
  const accessToken = generateAccessToken({ sub: staffId, identityType: "STAFF", roles, permissions });
  const refreshToken = generateRefreshToken();
  const expiresAt = expiryFromDays(REFRESH_TOKEN_EXPIRES_IN_DAYS);
  return { accessToken, refreshToken, refreshTokenHash: hashRefreshToken(refreshToken), expiresAt };
}

export async function loginStaff(input: { email: string; password: string }) {
  const staff = await prisma.staffAccount.findUnique({ where: { email: normalizeEmail(input.email) } });
  if (!staff?.passwordHash) throw new AppError("Invalid email or password", 401);
  const valid = await verifyPassword(input.password, staff.passwordHash);
  if (!valid) throw new AppError("Invalid email or password", 401);
  if (staff.status !== "ACTIVE") throw new AppError("Staff account is inactive", 403);

  const context = await staffAuthContext(staff.id);
  const tokens = createStaffTokens(staff.id, context.roles, context.permissions);
  await prisma.staffRefreshToken.create({
    data: {
      staffAccountId: staff.id,
      familyId: crypto.randomUUID(),
      tokenHash: tokens.refreshTokenHash,
      expiresAt: tokens.expiresAt,
    },
  });
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    staff: {
      id: staff.id, email: staff.email, firstName: staff.firstName, lastName: staff.lastName,
      roles: context.roles, permissions: context.permissions,
    },
  };
}

export async function refreshStaffAccessToken(input: { refreshToken: string }) {
  const tokenHash = hashRefreshToken(input.refreshToken);
  const stored = await prisma.staffRefreshToken.findUnique({ where: { tokenHash } });
  if (!stored) throw new AppError("Invalid or expired staff refresh token", 401);

  if (stored.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stored.familyId}::text, 0))`;
      await tx.staffRefreshToken.updateMany({
        where: { staffAccountId: stored.staffAccountId, familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    throw new AppError("Staff refresh token reuse detected; session revoked", 401);
  }
  if (stored.expiresAt <= new Date()) throw new AppError("Invalid or expired staff refresh token", 401);

  const context = await staffAuthContext(stored.staffAccountId);
  const tokens = createStaffTokens(context.staff.id, context.roles, context.permissions);
  const rotationSucceeded = await prisma.$transaction(async (tx) => {
    // Serialize all rotations and replay revocations within this staff session family.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stored.familyId}::text, 0))`;
    const now = new Date();
    const claimed = await tx.staffRefreshToken.updateMany({
      where: { id: stored.id, staffAccountId: stored.staffAccountId, familyId: stored.familyId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      const current = await tx.staffRefreshToken.findUnique({ where: { id: stored.id }, select: { revokedAt: true } });
      if (current?.revokedAt) {
        await tx.staffRefreshToken.updateMany({
          where: { staffAccountId: stored.staffAccountId, familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      return false;
    }
    await tx.staffRefreshToken.create({
      data: { staffAccountId: context.staff.id, familyId: stored.familyId, tokenHash: tokens.refreshTokenHash, expiresAt: tokens.expiresAt },
    });
    return true;
  });
  if (!rotationSucceeded) throw new AppError("Staff refresh token reuse detected; session revoked", 401);
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function getStaffProfile(staffId: string) {
  const { staff, roles, permissions } = await staffAuthContext(staffId);
  return {
    id: staff.id, email: staff.email, firstName: staff.firstName, lastName: staff.lastName,
    status: staff.status, emailVerifiedAt: staff.emailVerifiedAt, createdAt: staff.createdAt,
    roles, permissions,
  };
}

export async function listStaffRoles() {
  return prisma.role.findMany({
    where: { name: { not: "CUSTOMER" } },
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });
}

export async function listStaffAccounts() {
  return prisma.staffAccount.findMany({
    select: {
      id: true, email: true, firstName: true, lastName: true, status: true,
      createdAt: true, updatedAt: true,
      roles: { select: { role: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateStaffAccountRoles(
  actorId: string, staffId: string, roleIds: string[], metadata: RequestMetadata = {},
) {
  if (!roleIds.length) throw new AppError("An active staff account must have at least one role", 400);
  return prisma.$transaction(async (tx) => {
    const { roles } = await getDelegableRoles(tx, actorId, roleIds, [staffId]);
    const target = await tx.staffAccount.findUnique({
      where: { id: staffId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!target) throw new AppError("Staff account not found", 404);
    if (target.id === actorId && !roles.some(({ name }) => name === "BUSINESS_OWNER")) {
      throw new AppError("You cannot change your own staff roles", 403);
    }
    const previousRoles = target.roles.map(({ role }) => role.name);
    if (target.status === "ACTIVE" && previousRoles.includes("BUSINESS_OWNER") && !roles.some(({ name }) => name === "BUSINESS_OWNER")) {
      const otherActiveOwners = await tx.staffAccountRole.count({
        where: {
          role: { is: { name: "BUSINESS_OWNER" } },
          staffAccountId: { not: staffId },
          staffAccount: { is: { status: "ACTIVE" } },
        },
      });
      if (otherActiveOwners === 0) {
        throw new AppError("The last active business owner cannot lose the BUSINESS_OWNER role", 409);
      }
    }
    await tx.staffAccountRole.deleteMany({ where: { staffAccountId: staffId } });
    await tx.staffAccountRole.createMany({
      data: roles.map((role) => ({ staffAccountId: staffId, roleId: role.id, assignedByStaffAccountId: actorId })),
    });
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_ROLES_UPDATED",
      entity: "StaffAccount",
      entityId: staffId,
      oldValues: { roleNames: previousRoles },
      newValues: { roleNames: roles.map((role) => role.name) },
      ...metadata,
    });
    const nextRoles = roles.map((role) => role.name);
    if (JSON.stringify([...previousRoles].sort()) !== JSON.stringify([...nextRoles].sort())) {
      await publishNotificationEvent(tx, {
        eventType: "staff.security_event",
        aggregateType: "STAFF",
        aggregateId: staffId,
        deduplicationKey: crypto.randomUUID(),
        payload: {
          actorStaffAccountId: actorId,
          targetStaffAccountId: staffId,
          action: "Staff roles updated",
          previousRoles,
          newRoles: nextRoles,
        },
      });
    }
    return tx.staffAccount.findUniqueOrThrow({
      where: { id: staffId },
      select: {
        id: true, email: true, firstName: true, lastName: true, status: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateStaffAccountStatus(
  actorId: string, staffId: string, status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
  metadata: RequestMetadata = {},
) {
  if (actorId === staffId && status !== "ACTIVE") throw new AppError("You cannot suspend or deactivate your own account", 403);
  return prisma.$transaction(async (tx) => {
    await getStaffManagerContext(tx, actorId, [staffId]);
    const target = await tx.staffAccount.findUnique({
      where: { id: staffId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!target) throw new AppError("Staff account not found", 404);
    if (target.status === "PENDING_SETUP") throw new AppError("Pending staff setup must be completed through an invitation", 409);
    if (status === "ACTIVE" && target.roles.length === 0) {
      throw new AppError("A staff account must have at least one role before activation", 409);
    }
    if (target.status === "ACTIVE" && status !== "ACTIVE" && target.roles.some(({ role }) => role.name === "BUSINESS_OWNER")) {
      const otherActiveOwners = await tx.staffAccountRole.count({
        where: {
          role: { is: { name: "BUSINESS_OWNER" } },
          staffAccountId: { not: staffId },
          staffAccount: { is: { status: "ACTIVE" } },
        },
      });
      if (otherActiveOwners === 0) {
        throw new AppError("The last active business owner cannot be suspended or deactivated", 409);
      }
    }
    const updated = await tx.staffAccount.update({ where: { id: staffId }, data: { status } });
    if (status !== "ACTIVE") {
      await tx.staffRefreshToken.updateMany({
        where: { staffAccountId: staffId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await createAuditLog(tx, {
      staffAccountId: actorId,
      action: "STAFF_STATUS_UPDATED",
      entity: "StaffAccount",
      entityId: staffId,
      oldValues: { status: target.status },
      newValues: { status },
      ...metadata,
    });
    if (target.status !== status) {
      await publishNotificationEvent(tx, {
        eventType: "staff.security_event",
        aggregateType: "STAFF",
        aggregateId: staffId,
        deduplicationKey: crypto.randomUUID(),
        payload: {
          actorStaffAccountId: actorId,
          targetStaffAccountId: staffId,
          action: "Staff account status changed to " + status,
          previousStatus: target.status,
          newStatus: status,
        },
      });
    }
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
