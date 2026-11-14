import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { completeStaffInvitationSchema, exchangeStaffInvitationSchema, staffLoginSchema, staffRefreshSchema } from "./staff.validation";
import { acceptStaffInvitation, exchangeStaffInvitationToken, getStaffProfile, loginStaff, refreshStaffAccessToken } from "./staff.service";
import { env } from "../../config/env";

const invitationSessionCookie = "staff_invitation_session";
const invitationSessionCookiePath = "/api/v1/staff-auth";

function expectedInvitationOrigin(): string | null {
  const configured = env.STAFF_INVITATION_ACCEPTANCE_URL ??
    (env.APP_BASE_URL ? new URL("/staff/accept-invitation", env.APP_BASE_URL).toString() : undefined);
  if (!configured) return null;
  return new URL(configured).origin;
}

function setInvitationNoStoreHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function hasExpectedInvitationOrigin(req: Request): boolean {
  const origin = req.get("origin");
  const expected = expectedInvitationOrigin();
  return Boolean(origin && expected && origin === expected);
}

export async function exchangeInvitation(req: Request, res: Response): Promise<void> {
  setInvitationNoStoreHeaders(res);
  if (!hasExpectedInvitationOrigin(req)) {
    res.status(403).json({ message: "Invitation request is not allowed" });
    return;
  }
  const parsed = exchangeStaffInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid or expired invitation" });
    return;
  }

  const session = await exchangeStaffInvitationToken(parsed.data.token);
  res.cookie(invitationSessionCookie, session.sessionToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.COOKIE_SAME_SITE,
    path: invitationSessionCookiePath,
    expires: session.expiresAt,
  });
  res.status(200).json({
    message: "Invitation verified. Complete staff account setup to continue.",
    expiresAt: session.expiresAt,
  });
}

export async function acceptInvitation(req: Request, res: Response): Promise<void> {
  setInvitationNoStoreHeaders(res);
  if (!hasExpectedInvitationOrigin(req)) {
    res.status(403).json({ message: "Invitation request is not allowed" });
    return;
  }
  const sessionToken = req.cookies?.[invitationSessionCookie];
  if (typeof sessionToken !== "string" || !sessionToken) {
    res.status(400).json({ message: "Invitation session is invalid or expired" });
    return;
  }
  const parsed = completeStaffInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const staff = await acceptStaffInvitation({ ...parsed.data, sessionToken });
  res.clearCookie(invitationSessionCookie, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.COOKIE_SAME_SITE,
    path: invitationSessionCookiePath,
  });
  res.status(201).json({ message: "Staff account activated successfully", staff });
}
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = staffLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  res.status(200).json(await loginStaff(parsed.data));
}
export async function refresh(req: Request, res: Response): Promise<void> {
  const parsed = staffRefreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  res.status(200).json(await refreshStaffAccessToken(parsed.data));
}
export async function me(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const staff = await getStaffProfile(req.user.id);
  res.status(200).json({ message: "Staff profile retrieved successfully", staff });
}
