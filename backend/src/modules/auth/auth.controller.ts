import type { Request, Response } from "express";
import { z } from "zod";

import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
} from "./auth.validation";

import { registerUser, loginUser, refreshAccessToken } from "./auth.service";

import { mergeGuestCartIntoUserCart } from "../cart/cart.service";

import {
  GUEST_SESSION_COOKIE,
  clearGuestSessionCookie,
} from "../guest-session/guest-session.cookie";

import {
  getValidGuestSession,
  revokeGuestSession,
} from "../guest-session/guest-session.service";

async function mergeGuestCartIfPresent(
  req: Request,
  res: Response,
  userId: string,
): Promise<void> {
  const guestToken = req.cookies?.[GUEST_SESSION_COOKIE];

  // No guest session: preserve the normal authentication flow.
  if (typeof guestToken !== "string" || !guestToken) {
    return;
  }

  const guestSession = await getValidGuestSession(guestToken);

  // Invalid or expired guest cookies are cleared without
  // preventing the user from logging in or registering.
  if (!guestSession) {
    clearGuestSessionCookie(res);
    return;
  }

  // If merging fails, the error propagates and the guest
  // session is not revoked or cleared.
  await mergeGuestCartIntoUserCart(userId, guestSession.id);

  await revokeGuestSession(guestToken);
  clearGuestSessionCookie(res);
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = registerSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const user = await registerUser(result.data);

  await mergeGuestCartIfPresent(req, res, user.id);

  res.status(201).json({
    message: "Account created successfully",
    user,
  });
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
