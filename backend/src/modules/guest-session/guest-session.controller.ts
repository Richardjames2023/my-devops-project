import type { Request, Response, NextFunction } from "express";
import {
  createGuestSession,
  getValidGuestSession,
  revokeGuestSession,
} from "./guest-session.service";
import {
  clearGuestSessionCookie,
  GUEST_SESSION_COOKIE,
  setGuestSessionCookie,
} from "./guest-session.cookie";

export async function startGuestSession(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, token } = await createGuestSession();

    setGuestSessionCookie(res, token);

    res.status(201).json({
      message: "Guest session created",
      data: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getGuestSessionStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[GUEST_SESSION_COOKIE];

    if (typeof token !== "string") {
      res.status(200).json({
        authenticated: false,
        guestSession: null,
      });
      return;
    }

    const session = await getValidGuestSession(token);

    if (!session) {
      clearGuestSessionCookie(res);

      res.status(200).json({
        authenticated: false,
        guestSession: null,
      });
      return;
    }

    res.status(200).json({
      authenticated: false,
      guestSession: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function endGuestSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[GUEST_SESSION_COOKIE];

    if (typeof token === "string") {
      await revokeGuestSession(token);
    }

    clearGuestSessionCookie(res);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
