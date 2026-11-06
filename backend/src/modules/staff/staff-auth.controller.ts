import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { acceptStaffInvitationSchema, staffLoginSchema, staffRefreshSchema } from "./staff.validation";
import { acceptStaffInvitation, getStaffProfile, loginStaff, refreshStaffAccessToken } from "./staff.service";

export async function acceptInvitation(req: Request, res: Response): Promise<void> {
  const parsed = acceptStaffInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const staff = await acceptStaffInvitation(parsed.data);
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
