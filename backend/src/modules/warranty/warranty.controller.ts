import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  createWarrantyClaimSchema,
  warrantyClaimListQuerySchema,
  reviewWarrantyClaimSchema,
  resolveWarrantyClaimSchema,
} from "./warranty.validation";
import {
  createWarrantyClaim,
  listCustomerWarrantyClaims,
  getCustomerWarrantyClaim,
  listWarrantyClaims,
  reviewWarrantyClaim,
  resolveWarrantyClaim,
} from "./warranty.service";

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    message: "Validation failed",
    errors: z.flattenError(error).fieldErrors,
  });
}

function parseClaimId(req: AuthenticatedRequest, res: Response): string | null {
  const result = z.object({ claimId: z.uuid("Invalid warranty claim ID") }).safeParse(req.params);
  if (!result.success) {
    sendValidationError(res, result.error);
    return null;
  }
  return result.data.claimId;
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
  const claimId = parseClaimId(req, res);
  if (!claimId) return;
  const claim = await getCustomerWarrantyClaim(req.user.id, claimId);
  res.status(200).json({ message: "Warranty claim retrieved successfully", claim });
}

export async function listAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = warrantyClaimListQuerySchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const result = await listWarrantyClaims(parsed.data);
  res.status(200).json({ message: "Warranty claims retrieved successfully", ...result });
}

export async function review(req: AuthenticatedRequest, res: Response): Promise<void> {
  const claimId = parseClaimId(req, res);
  if (!claimId) return;
  const parsed = reviewWarrantyClaimSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const claim = await reviewWarrantyClaim(claimId, parsed.data);
  res.status(200).json({ message: "Warranty claim reviewed successfully", claim });
}

export async function resolve(req: AuthenticatedRequest, res: Response): Promise<void> {
  const claimId = parseClaimId(req, res);
  if (!claimId) return;
  const parsed = resolveWarrantyClaimSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const claim = await resolveWarrantyClaim(claimId, parsed.data);
  res.status(200).json({ message: "Warranty claim resolved successfully", claim });
}
