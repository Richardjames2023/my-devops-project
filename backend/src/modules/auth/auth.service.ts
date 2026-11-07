import crypto from "node:crypto";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

import { hashPassword, verifyPassword } from "../../common/utils/password";
import { generateAccessToken } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS } from "../../config/auth";
import type { RegisterInput, LoginInput, RefreshTokenInput } from "./auth.validation";

export async function registerUser(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    throw new AppError("Unable to create account", 409);
  }

  const customerRole = await prisma.role.findUnique({
    where: { name: "CUSTOMER" },
  });

  if (!customerRole) {
    throw new AppError("Customer role is not configured", 500, false);
  }

  const passwordHash = await hashPassword(input.password);

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

    await tx.userRole.create({
      data: { userId: createdUser.id, roleId: customerRole.id },
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

  const roles = user.userRoles.map((userRole) => userRole.role.name);
  const permissions = [...new Set(user.userRoles.flatMap((userRole) =>
    userRole.role.permissions.map((rolePermission) => rolePermission.permission.name),
  ))];
  const accessToken = generateAccessToken({ sub: user.id, identityType: "CUSTOMER", roles, permissions });
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
