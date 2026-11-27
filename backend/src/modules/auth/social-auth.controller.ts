import type { Request, Response } from "express";
import { z } from "zod";
import { authenticateWithFacebook, authenticateWithGoogle } from "./social-auth.service";
import { mergeGuestCartIntoUserCart } from "../cart/cart.service";
import { GUEST_SESSION_COOKIE, clearGuestSessionCookie } from "../guest-session/guest-session.cookie";
import { getValidGuestSession, revokeGuestSession } from "../guest-session/guest-session.service";

const googleSchema = z.object({ credential: z.string().min(20).max(10_000) });
const facebookSchema = z.object({ accessToken: z.string().min(20).max(10_000) });

async function mergeGuestCart(req: Request, res: Response, userId: string) {
  const token = req.cookies?.[GUEST_SESSION_COOKIE];
  if (typeof token !== "string" || !token) return;
  const session = await getValidGuestSession(token);
  if (!session) { clearGuestSessionCookie(res); return; }
  await mergeGuestCartIntoUserCart(userId, session.id);
  await revokeGuestSession(token);
  clearGuestSessionCookie(res);
}

export async function googleSignIn(req: Request, res: Response): Promise<void> {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "A valid Google credential is required" }); return; }
  const result = await authenticateWithGoogle(parsed.data.credential);
  await mergeGuestCart(req, res, result.user.id);
  res.status(200).json(result);
}

export async function facebookSignIn(req: Request, res: Response): Promise<void> {
  const parsed = facebookSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "A valid Facebook access token is required" }); return; }
  const result = await authenticateWithFacebook(parsed.data.accessToken);
  await mergeGuestCart(req, res, result.user.id);
  res.status(200).json(result);
}
