import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { hashPassword, verifyPassword } from "../../common/utils/password";
import { generateAccessToken } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS } from "../../config/auth";
import { createAuditLog } from "../../common/utils/audit-log";

const invitationDaysDefault = 7;
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

async function getDelegableRoles(actorId: string, roleIds: string[]) {
  const actor = await prisma.staffAccount.findUnique({
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
  const isBusinessOwner = actorRoleNames.includes("BUSINESS_OWNER");

  const roles = await prisma.role.findMany({
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

export async function createStaffInvitation(
  actorId: string,
  input: { email: string; roleIds: string[]; expiresInDays?: number },
  metadata: RequestMetadata = {},
) {
  const email = normalizeEmail(input.email);
  const days = input.expiresInDays ?? invitationDaysDefault;
  if (days < 1 || days > invitationDaysMax) {
    throw new AppError(`Invitation expiry must be between 1 and ${invitationDaysMax} days`, 400);
  }
  if (!input.roleIds.length) throw new AppError("At least one staff role is required", 400);

  const { roles } = await getDelegableRoles(actorId, input.roleIds);
  await prisma.staffInvitation.updateMany({
    where: { email, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const existingStaff = await prisma.staffAccount.findUnique({ where: { email }, select: { id: true, status: true } });
  if (existingStaff && existingStaff.status !== "PENDING_SETUP") {
    throw new AppError("A staff account already exists for this email address", 409);
  }

  const pending = await prisma.staffInvitation.findFirst({
    where: { email, status: "PENDING", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (pending) throw new AppError("A pending invitation already exists for this email address", 409);

  const token = crypto.randomBytes(32).toString("hex");
  const invitation = await prisma.$transaction(async (tx) => {
    const createdBase = await tx.staffInvitation.create({
      data: {
        email,
        tokenHash: hashRefreshToken(token),
        expiresAt: expiryFromDays(days),
        createdByStaffAccountId: actorId,
      },
    });
    await tx.staffInvitationRole.createMany({
      data: roles.map((role) => ({ invitationId: createdBase.id, roleId: role.id })),
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
    return created;
  });

  // The raw token is returned once so the trusted admin UI can hand it to the
  // configured email-delivery adapter. Only the hash is persisted.
  const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
  return { invitation: safeInvitation, invitationToken: token };
}

export async function listStaffInvitations() {
  await prisma.staffInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return prisma.staffInvitation.findMany({
    select: {
      id: true, email: true, status: true, expiresAt: true, acceptedAt: true,
      revokedAt: true, createdAt: true, updatedAt: true, createdByStaffAccountId: true,
      roles: { select: { role: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    /* include: {
      roles: { include: { role: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    }, */
    orderBy: { createdAt: "desc" },
  });
}

export async function resendStaffInvitation(
  actorId: string, invitationId: string, metadata: RequestMetadata = {},
) {
  const token = crypto.randomBytes(32).toString("hex");
  const updated = await prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
      throw new AppError("Only unexpired pending invitations can be resent", 409);
    }
    const result = await tx.staffInvitation.update({
      where: { id: invitationId },
      data: { tokenHash: hashRefreshToken(token), expiresAt: expiryFromDays(invitationDaysDefault) },
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
    return result;
  });
  const { tokenHash: _tokenHash, ...safeInvitation } = updated;
  return { invitation: safeInvitation, invitationToken: token };
}

export async function updateStaffInvitationRoles(
  actorId: string,
  invitationId: string,
  roleIds: string[],
  metadata: RequestMetadata = {},
) {
  if (!roleIds.length) throw new AppError("An invitation must contain at least one role", 400);
  const { roles } = await getDelegableRoles(actorId, roleIds);

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({
      where: { id: invitationId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
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
    return updated;
  });
}

export async function revokeStaffInvitation(actorId: string, invitationId: string, metadata: RequestMetadata = {}) {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError("Staff invitation not found", 404);
    if (invitation.status !== "PENDING") throw new AppError("Only pending invitations can be revoked", 409);

    const updated = await tx.staffInvitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
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
    return safeUpdated;
  });
}

export async function acceptStaffInvitation(input: {
  token: string; password: string; firstName: string; lastName: string;
}) {
  const tokenHash = hashRefreshToken(input.token);
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({
      where: { tokenHash },
      include: { roles: { select: { roleId: true, role: { select: { name: true } } } } },
    });
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
      throw new AppError("This staff invitation is invalid, expired, or already used", 400);
    }
    if (!invitation.roles.length) throw new AppError("This invitation has no assigned staff roles", 409);

    const claimed = await tx.staffInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError("This invitation has already been used", 409);

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
      data: invitation.roles.map(({ roleId }) => ({ staffAccountId: staff.id, roleId })),
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
    data: { staffAccountId: staff.id, tokenHash: tokens.refreshTokenHash, expiresAt: tokens.expiresAt },
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
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw new AppError("Invalid or expired staff refresh token", 401);
  }
  const context = await staffAuthContext(stored.staffAccountId);
  const tokens = createStaffTokens(context.staff.id, context.roles, context.permissions);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.staffRefreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError("Staff refresh token has already been used", 401);
    await tx.staffRefreshToken.create({
      data: { staffAccountId: context.staff.id, tokenHash: tokens.refreshTokenHash, expiresAt: tokens.expiresAt },
    });
  });
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
  const { roles } = await getDelegableRoles(actorId, roleIds);
  return prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({
      where: { id: staffId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!target) throw new AppError("Staff account not found", 404);
    if (target.id === actorId && !roles.some(({ name }) => name === "BUSINESS_OWNER")) {
      throw new AppError("You cannot change your own staff roles", 403);
    }
    const previousRoles = target.roles.map(({ role }) => role.name);
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
    return tx.staffAccount.findUniqueOrThrow({
      where: { id: staffId },
      select: {
        id: true, email: true, firstName: true, lastName: true, status: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
  });
}

export async function updateStaffAccountStatus(
  actorId: string, staffId: string, status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
  metadata: RequestMetadata = {},
) {
  if (actorId === staffId && status !== "ACTIVE") throw new AppError("You cannot suspend or deactivate your own account", 403);
  return prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({ where: { id: staffId } });
    if (!target) throw new AppError("Staff account not found", 404);
    if (target.status === "PENDING_SETUP") throw new AppError("Pending staff setup must be completed through an invitation", 409);
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
    return updated;
  });
}
