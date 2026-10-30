
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import {
  getValidGuestSession,
} from "./guest-session.service";
import {
  GUEST_SESSION_COOKIE,
  clearGuestSessionCookie,
} from "./guest-session.cookie";

export interface GuestSessionRequest extends Request {
  guestSessionId?: string;
}

export async function requireGuestSession(
  req: GuestSessionRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[GUEST_SESSION_COOKIE];

    if (typeof token !== "string") {
      throw new AppError("Guest session required", 401);
    }

    const session = await getValidGuestSession(token);

    if (!session) {
      clearGuestSessionCookie(res);
      throw new AppError("Guest session is invalid or expired", 401);
    }

    req.guestSessionId = session.id;
    next();
  } catch (error) {
    next(error);
  }
}
