import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";

export const GUEST_SESSION_COOKIE = "guest_session";
const GUEST_SESSION_TTL_DAYS = 30;

const guestSessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production" || env.COOKIE_SAME_SITE === "none",
  sameSite: env.COOKIE_SAME_SITE,
  path: "/",
  maxAge: GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
};

export function setGuestSessionCookie(res: Response, token: string): void {
  res.cookie(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions);
}

export function clearGuestSessionCookie(res: Response): void {
  const { maxAge, ...clearOptions } = guestSessionCookieOptions;

  res.clearCookie(GUEST_SESSION_COOKIE, clearOptions);
}
