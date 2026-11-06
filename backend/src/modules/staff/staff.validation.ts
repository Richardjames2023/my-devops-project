import { z } from "zod";

export const staffInvitationSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  roleIds: z.array(z.uuid()).min(1).max(10),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});
export const updateInvitationRolesSchema = z.object({
  roleIds: z.array(z.uuid()).min(1).max(10),
});
export const updateStaffRolesSchema = z.object({
  roleIds: z.array(z.uuid()).min(1).max(10),
});
export const updateStaffStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
});
export const acceptStaffInvitationSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});
export const staffLoginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});
export const staffRefreshSchema = z.object({ refreshToken: z.string().min(1) });
