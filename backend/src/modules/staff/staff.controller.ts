import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  staffInvitationSchema, updateInvitationRolesSchema, updateStaffRolesSchema, updateStaffStatusSchema,
} from "./staff.validation";
import {
  createStaffInvitation, listStaffAccounts, listStaffInvitations, listStaffRoles, resendStaffInvitation, revokeStaffInvitation,
  updateStaffAccountRoles, updateStaffAccountStatus, updateStaffInvitationRoles,
} from "./staff.service";

function metadata(req: AuthenticatedRequest) {
  return {
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(req.get("user-agent") ? { userAgent: req.get("user-agent")! } : {}),
  };
}
function actor(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user || req.user.identityType !== "STAFF") {
    res.status(401).json({ message: "Staff authentication required" });
    return null;
  }
  return req.user.id;
}
export async function createInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const parsed = staffInvitationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors }); return; }
  const result = await createStaffInvitation(actorId, parsed.data, metadata(req));
  res.status(201).json({
    message: "Staff invitation created. The invitation token is returned once; deliver it through the configured trusted email channel.",
    invitation: result.invitation,
    invitationToken: result.invitationToken,
  });
}
export async function updateInvitationRoles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const params = z.object({ invitationId: z.uuid() }).safeParse(req.params);
  const body = updateInvitationRolesSchema.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ message: "Validation failed", errors: { ...(!params.success ? z.flattenError(params.error).fieldErrors : {}), ...(!body.success ? z.flattenError(body.error).fieldErrors : {}) } }); return; }
  const invitation = await updateStaffInvitationRoles(actorId, params.data.invitationId, body.data.roleIds, metadata(req));
  res.status(200).json({ message: "Invitation roles updated", invitation });
}
export async function revokeInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const params = z.object({ invitationId: z.uuid() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ message: "Validation failed", errors: z.flattenError(params.error).fieldErrors }); return; }
  const invitation = await revokeStaffInvitation(actorId, params.data.invitationId, metadata(req));
  res.status(200).json({ message: "Invitation revoked", invitation });
}
export async function listStaff(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ staff: await listStaffAccounts() });
}
export async function updateRoles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const params = z.object({ staffId: z.uuid() }).safeParse(req.params);
  const body = updateStaffRolesSchema.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ message: "Validation failed", errors: { ...(!params.success ? z.flattenError(params.error).fieldErrors : {}), ...(!body.success ? z.flattenError(body.error).fieldErrors : {}) } }); return; }
  const staff = await updateStaffAccountRoles(actorId, params.data.staffId, body.data.roleIds, metadata(req));
  res.status(200).json({ message: "Staff roles updated", staff });
}
export async function updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const params = z.object({ staffId: z.uuid() }).safeParse(req.params);
  const body = updateStaffStatusSchema.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ message: "Validation failed", errors: { ...(!params.success ? z.flattenError(params.error).fieldErrors : {}), ...(!body.success ? z.flattenError(body.error).fieldErrors : {}) } }); return; }
  const staff = await updateStaffAccountStatus(actorId, params.data.staffId, body.data.status, metadata(req));
  res.status(200).json({ message: "Staff status updated", staff });
}

export async function listInvitations(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ invitations: await listStaffInvitations() });
}
export async function resendInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = actor(req, res); if (!actorId) return;
  const params = z.object({ invitationId: z.uuid() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ message: "Validation failed", errors: z.flattenError(params.error).fieldErrors }); return; }
  const result = await resendStaffInvitation(actorId, params.data.invitationId, metadata(req));
  res.status(200).json({
    message: "Invitation token rotated. Deliver the new token through the configured trusted email channel.",
    invitation: result.invitation,
    invitationToken: result.invitationToken,
  });
}

export async function listRoles(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ roles: await listStaffRoles() });
}
