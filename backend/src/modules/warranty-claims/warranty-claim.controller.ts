import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  createWarrantyClaimSchema,
  reviewWarrantyClaimSchema,
  warrantyClaimListQuerySchema,
} from "./warranty-claim.validation";
import {
  createWarrantyClaim,
  getCustomerWarrantyClaim,
  listCustomerWarrantyClaims,
  listWarrantyClaims,
  reviewWarrantyClaim,
} from "./warranty-claim.service";

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({ message: "Validation failed", errors: z.flattenError(error).fieldErrors });
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const parsed = createWarrantyClaimSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const claim = await createWarrantyClaim(req.user.id, parsed.data);
  res.status(201).json({ message: "Warranty claim submitted successfully", claim });
}

export async function listMine(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const parsed = warrantyClaimListQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const result = await listCustomerWarrantyClaims(req.user.id, parsed.data);
  res.status(200).json({ message: "Warranty claims retrieved successfully", ...result });
}

export async function getMine(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ message: "Authentication required" }); return; }
  const parsed = z.object({ claimId: z.uuid("Invalid warranty claim ID") }).safeParse(req.params);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const claim = await getCustomerWarrantyClaim(req.user.id, parsed.data.claimId);
  res.status(200).json({ message: "Warranty claim retrieved successfully", claim });
}

export async function listAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = warrantyClaimListQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const result = await listWarrantyClaims(parsed.data);
  res.status(200).json({ message: "Warranty claims retrieved successfully", ...result });
}

export async function review(req: AuthenticatedRequest, res: Response): Promise<void> {
  const params = z.object({ claimId: z.uuid("Invalid warranty claim ID") }).safeParse(req.params);
  if (!params.success) { sendValidationError(res, params.error); return; }
  const body = reviewWarrantyClaimSchema.safeParse(req.body);
  if (!body.success) { sendValidationError(res, body.error); return; }
  const claim = await reviewWarrantyClaim(params.data.claimId, body.data);
  res.status(200).json({ message: "Warranty claim updated successfully", claim });
}
