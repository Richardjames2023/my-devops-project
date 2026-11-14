import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  cancelAccountDeletionSchema,
  requestAccountDeletionSchema,
  updateCustomerProfileSchema,
} from "./customer-profile.validation";
import {
  cancelCustomerAccountDeletion,
  requestCustomerAccountDeletion,
  updateCustomerProfile,
} from "./customer-profile.service";

export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const parsed = updateCustomerProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const user = await updateCustomerProfile(req.user.id, parsed.data);
  res.status(200).json({ message: "Profile updated successfully", user });
}

export async function requestAccountDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const parsed = requestAccountDeletionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Password confirmation is required", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const deletion = await requestCustomerAccountDeletion(req.user.id, parsed.data.password);
  res.status(202).json({
    message: "Account deactivated. You may cancel the deletion request within 30 days.",
    deletion,
  });
}

export async function cancelAccountDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = cancelAccountDeletionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Valid email and password are required", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const result = await cancelCustomerAccountDeletion(parsed.data.email, parsed.data.password);
  res.status(200).json(result);
}
