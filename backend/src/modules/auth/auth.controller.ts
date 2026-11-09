import type { Request, Response } from "express";
import { z } from "zod";

import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  resendVerificationSchema,
} from "./auth.validation";

import { registerUser, loginUser, refreshAccessToken, verifyCustomerEmail, resendCustomerEmailVerification } from "./auth.service";

import { mergeGuestCartIntoUserCart } from "../cart/cart.service";

import {
  GUEST_SESSION_COOKIE,
  clearGuestSessionCookie,
} from "../guest-session/guest-session.cookie";

import {
  getValidGuestSession,
  revokeGuestSession,
} from "../guest-session/guest-session.service";
import prisma from "../../infrastructure/prisma/client";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";

async function mergeGuestCartIfPresent(
  req: Request,
  res: Response,
  userId: string,
): Promise<void> {
  const guestToken = req.cookies?.[GUEST_SESSION_COOKIE];

  if (typeof guestToken !== "string" || !guestToken) {
    return;
  }

  const guestSession = await getValidGuestSession(guestToken);

  if (!guestSession) {
    clearGuestSessionCookie(res);
    return;
  }

  await mergeGuestCartIntoUserCart(userId, guestSession.id);
  await revokeGuestSession(guestToken);
  clearGuestSessionCookie(res);
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = registerSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }

  const user = await registerUser(result.data);

  res.status(201).json({
    message: "Account created. Please check your email for a verification link before logging in.",
    user,
  });
}

export async function resendVerificationEmail(req: Request, res: Response): Promise<void> {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "A valid email address is required" });
    return;
  }
  await resendCustomerEmailVerification(parsed.data.email);
  res.status(200).json({ message: "If an unverified account exists for this email, a verification link will be sent." });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const parsed = z.object({ token: z.string().min(32).max(256) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "A valid verification token is required" });
    return;
  }
  await verifyCustomerEmail(parsed.data.token);
  res.status(200).json({ message: "Email address verified successfully. You can now log in." });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: result.error.flatten().fieldErrors,
    });
    return;
  }

  const resultData = await loginUser(result.data);
  await mergeGuestCartIfPresent(req, res, resultData.user.id);
  res.status(200).json(resultData);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const result = refreshTokenSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: result.error.flatten().fieldErrors,
    });
    return;
  }

  const resultData = await refreshAccessToken(result.data);
  res.status(200).json(resultData);
}

export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      emailVerified: true,
      isActive: true,
      createdAt: true,
      userRoles: {
        select: {
          role: {
            select: {
              name: true,
              permissions: {
                select: {
                  permission: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ message: "Authenticated user is unavailable" });
    return;
  }

  const roles = user.userRoles.map(({ role }) => role.name);
  const permissions = [
    ...new Set(
      user.userRoles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.name),
      ),
    ),
  ];

  const { userRoles: _userRoles, isActive: _isActive, ...profile } = user;
  res.status(200).json({
    message: "Profile retrieved successfully",
    user: { ...profile, roles, permissions },
  });
}
