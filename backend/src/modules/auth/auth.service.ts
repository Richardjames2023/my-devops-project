import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

import { hashPassword, verifyPassword, } from "../../common/utils/password";
import { generateAccessToken, } from "../../common/utils/jwt";
import { generateRefreshToken, hashRefreshToken, } from "../../common/utils/refreshToken";
import { REFRESH_TOKEN_EXPIRES_IN_DAYS, } from "../../config/auth";
import type { RegisterInput, LoginInput, RefreshTokenInput, } from "./auth.validation";


export async function registerUser(
  input: RegisterInput,
) {
  const existingUser = await prisma.user.findUnique({
    where: {
      email: input.email,
    },
  });

  if (existingUser) {
    throw new AppError(
      "Unable to create account",
      409,
    );
  }

  const customerRole = await prisma.role.findUnique({
    where: {
      name: "CUSTOMER",
    },
  });

  if (!customerRole) {
    throw new AppError(
      "Customer role is not configured",
      500,
      false,
    );
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
      data: {
        userId: createdUser.id,
        roleId: customerRole.id,
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

export async function loginUser(
  input: LoginInput,
) {
  const user = await prisma.user.findUnique({
    where: {
      email: input.email,
    },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new AppError(
      "Invalid email or password",
      401,
    );
  }

  const passwordValid = await verifyPassword(
    input.password,
    user.passwordHash,
  );

  if (!passwordValid) {
    throw new AppError(
      "Invalid email or password",
      401,
    );
  }

  if (!user.isActive) {
    throw new AppError(
      "Account is inactive",
      403,
    );
  }

  const roles = user.userRoles.map(
    (userRole) => userRole.role.name,
  );

  const permissions = [
    ...new Set(
      user.userRoles.flatMap(
        (userRole) =>
          userRole.role.permissions.map(
            (rolePermission) =>
              rolePermission.permission.name,
          ),
      ),
    ),
  ];

  const accessToken = generateAccessToken({
    sub: user.id,
    roles,
    permissions,
  });

  const refreshToken = generateRefreshToken();

  const refreshTokenHash =
    hashRefreshToken(refreshToken);

  const refreshTokenExpiresAt = new Date();

  refreshTokenExpiresAt.setDate(
    refreshTokenExpiresAt.getDate() +
      REFRESH_TOKEN_EXPIRES_IN_DAYS,
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
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

export async function refreshAccessToken(
  input: RefreshTokenInput,
) {
  const refreshTokenHash = hashRefreshToken(
    input.refreshToken,
  );

  const storedToken = await prisma.refreshToken.findUnique({
    where: {
      tokenHash: refreshTokenHash,
    },
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!storedToken) {
    throw new AppError(
      "Invalid refresh token",
      401,
    );
  }

  if (storedToken.revokedAt) {
    throw new AppError(
      "Refresh token has been revoked",
      401,
    );
  }

  if (storedToken.expiresAt <= new Date()) {
    throw new AppError(
      "Refresh token has expired",
      401,
    );
  }

  const user = storedToken.user;

  if (!user.isActive) {
    throw new AppError(
      "Account is inactive",
      403,
    );
  }

  const roles = user.userRoles.map(
    (userRole) => userRole.role.name,
  );

  const permissions = [
    ...new Set(
      user.userRoles.flatMap(
        (userRole) =>
          userRole.role.permissions.map(
            (rolePermission) =>
              rolePermission.permission.name,
          ),
      ),
    ),
  ];

  const accessToken = generateAccessToken({
    sub: user.id,
    roles,
    permissions,
  });

  const newRefreshToken = generateRefreshToken();

  const newRefreshTokenHash =
    hashRefreshToken(newRefreshToken);

  const newRefreshTokenExpiresAt = new Date();

  newRefreshTokenExpiresAt.setDate(
    newRefreshTokenExpiresAt.getDate() +
      REFRESH_TOKEN_EXPIRES_IN_DAYS,
  );

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: {
        id: storedToken.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newRefreshTokenHash,
        expiresAt: newRefreshTokenExpiresAt,
      },
    });
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
}