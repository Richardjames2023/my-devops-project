import crypto from "node:crypto";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

import { hashPassword, verifyPassword } from "../../common/utils/password";
import { generateAccessToken } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS } from "../../config/auth";
import type { RegisterInput, LoginInput, RefreshTokenInput } from "./auth.validation";
import type { ResetPasswordInput } from "./auth.validation";

export async function registerUser(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new AppError("Unable to create account", 409);

  const customerRole = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
  if (!customerRole) throw new AppError("Customer role is not configured", 500, false);

  const passwordHash = await hashPassword(input.password);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashRefreshToken(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
      },
    });
    await tx.userRole.create({ data: { userId: createdUser.id, roleId: customerRole.id } });
    await tx.customerEmailVerificationToken.create({
      data: { userId: createdUser.id, tokenHash, expiresAt },
    });
    await tx.notificationEmailDelivery.create({
      data: {
        recipientEmail: createdUser.email,
        templateKey: "customer.email-verification",
        templateData: {
          firstName: createdUser.firstName,
          actionUrl: "/verify-email?token=" + encodeURIComponent(verificationToken),
        },
      },
    });
    return createdUser;
  });

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

export async function resendCustomerEmailVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, emailVerified: true, isActive: true },
  });
  if (!user || user.emailVerified || !user.isActive) return;

  const verificationToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashRefreshToken(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}::text, 0))`;
    await tx.customerEmailVerificationToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.customerEmailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
    await tx.notificationEmailDelivery.create({
      data: {
        recipientEmail: user.email,
        templateKey: "customer.email-verification",
        templateData: {
          firstName: user.firstName,
          actionUrl: "/verify-email?token=" + encodeURIComponent(verificationToken),
        },
      },
    });
  });
}

export async function verifyCustomerEmail(token: string): Promise<void> {
  const tokenHash = hashRefreshToken(token);
  await prisma.$transaction(async (tx) => {
    const stored = await tx.customerEmailVerificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, consumedAt: true },
    });
    if (!stored || stored.consumedAt || stored.expiresAt <= new Date()) {
      throw new AppError("This email verification link is invalid or expired", 400);
    }

    const claimed = await tx.customerEmailVerificationToken.updateMany({
      where: { id: stored.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new AppError("This email verification link is invalid or expired", 400);
    }

    await tx.user.update({
      where: { id: stored.userId },
      data: { emailVerified: true },
    });
    await tx.customerEmailVerificationToken.updateMany({
      where: { userId: stored.userId, id: { not: stored.id }, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  });
}

export async function requestCustomerPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, emailVerified: true, isActive: true },
  });

  // Keep the response identical for unknown, inactive, and unverified accounts.
  if (!user || !user.isActive || !user.emailVerified) return;

  const resetToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashRefreshToken(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Serialize reset requests so only the newest outstanding link remains valid.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}::text, 0))`;
    await tx.customerPasswordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.customerPasswordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
    await tx.notificationEmailDelivery.create({
      data: {
        recipientEmail: user.email,
        templateKey: "customer.password-reset",
        templateData: {
          firstName: user.firstName,
          actionUrl: "/reset-password?token=" + encodeURIComponent(resetToken),
        },
      },
    });
  });
}

export async function resetCustomerPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashRefreshToken(input.token);
  // Hash outside the transaction to avoid holding database locks during Argon2 work.
  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    const stored = await tx.customerPasswordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, consumedAt: true },
    });
    if (!stored || stored.consumedAt || stored.expiresAt <= new Date()) {
      throw new AppError("This password reset link is invalid or expired", 400);
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stored.userId}::text, 0))`;
    const current = await tx.customerPasswordResetToken.findUnique({
      where: { id: stored.id },
      select: { id: true, userId: true, expiresAt: true, consumedAt: true },
    });
    if (!current || current.consumedAt || current.expiresAt <= new Date()) {
      throw new AppError("This password reset link is invalid or expired", 400);
    }

    const now = new Date();
    const claimed = await tx.customerPasswordResetToken.updateMany({
      where: { id: current.id, userId: current.userId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      throw new AppError("This password reset link is invalid or expired", 400);
    }

    const updated = await tx.user.updateMany({
      where: { id: current.userId, isActive: true, emailVerified: true },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new AppError("This password reset link is invalid or expired", 400);
    }

    // Revoke every outstanding refresh-token family for this customer.
    await tx.refreshToken.updateMany({
      where: { userId: current.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    // Consume any other outstanding reset links for the same account.
    await tx.customerPasswordResetToken.updateMany({
      where: { userId: current.userId, id: { not: current.id }, consumedAt: null },
      data: { consumedAt: now },
    });
  });
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    throw new AppError("Invalid email or password", 401);
  }

  if (!user.isActive) {
    throw new AppError("Account is inactive", 403);
  }

  if (!user.emailVerified) {
    throw new AppError("Please verify your email address before logging in", 403);
  }

  const roles = user.userRoles.map((userRole) => userRole.role.name);
  const permissions = [
    ...new Set(
      user.userRoles.flatMap((userRole) =>
        userRole.role.permissions.map((rolePermission) =>
          rolePermission.permission.name,
        ),
      ),
    ),
  ];

  const accessToken = generateAccessToken({
    sub: user.id,
    identityType: "CUSTOMER",
    sessionVersion: user.sessionVersion,
    roles,
    permissions,
  });

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshTokenExpiresAt = new Date();
  refreshTokenExpiresAt.setDate(
    refreshTokenExpiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN_DAYS,
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId: crypto.randomUUID(),
      tokenHash: refreshTokenHash,
      expiresAt: refreshTokenExpiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      emailVerified: user.emailVerified,
      roles,
      permissions,
    },
  };
}

export async function refreshAccessToken(input: RefreshTokenInput) {
  const refreshTokenHash = hashRefreshToken(input.refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: refreshTokenHash },
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: { include: { permissions: { include: { permission: true } } } },
            },
          },
        },
      },
    },
  });

  if (!storedToken) throw new AppError("Invalid refresh token", 401);

  if (storedToken.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${storedToken.familyId}::text, 0))`;
      await tx.refreshToken.updateMany({
        where: { userId: storedToken.userId, familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    throw new AppError("Refresh token reuse detected; session revoked", 401);
  }
  if (storedToken.expiresAt <= new Date()) throw new AppError("Refresh token has expired", 401);

  const user = storedToken.user;
  if (!user.isActive) throw new AppError("Account is inactive", 403);
  if (!user.emailVerified) throw new AppError("Please verify your email address before logging in", 403);

  const roles = user.userRoles.map((userRole) => userRole.role.name);
  const permissions = [...new Set(user.userRoles.flatMap((userRole) =>
    userRole.role.permissions.map((rolePermission) => rolePermission.permission.name),
  ))];
  const accessToken = generateAccessToken({ sub: user.id, identityType: "CUSTOMER", sessionVersion: user.sessionVersion, roles, permissions });
  const newRefreshToken = generateRefreshToken();
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
  const newRefreshTokenExpiresAt = new Date();
  newRefreshTokenExpiresAt.setDate(newRefreshTokenExpiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN_DAYS);

  const rotationSucceeded = await prisma.$transaction(async (tx) => {
    // Serialize all rotations and replay revocations within this session family.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${storedToken.familyId}::text, 0))`;
    const now = new Date();
    const claimed = await tx.refreshToken.updateMany({
      where: { id: storedToken.id, userId: storedToken.userId, familyId: storedToken.familyId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      const current = await tx.refreshToken.findUnique({ where: { id: storedToken.id }, select: { revokedAt: true } });
      if (current?.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { userId: storedToken.userId, familyId: storedToken.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      return false;
    }
    await tx.refreshToken.create({
      data: { userId: user.id, familyId: storedToken.familyId, tokenHash: newRefreshTokenHash, expiresAt: newRefreshTokenExpiresAt },
    });
    return true;
  });
  if (!rotationSucceeded) throw new AppError("Refresh token reuse detected; session revoked", 401);
  return { accessToken, refreshToken: newRefreshToken };
}
