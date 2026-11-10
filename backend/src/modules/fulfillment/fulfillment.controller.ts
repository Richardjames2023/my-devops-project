import type { Response } from "express";
import { z } from "zod";
import {
  allocatePackageSchema,
  createFulfillmentSchema,
  updatePackageStatusSchema,
} from "./fulfillment.validation";
import {
  allocatePackage,
  createFulfillment,
  listReadyOrders,
  updatePackageStatus,
} from "./fulfillment.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";

const packageIdSchema = z.object({
  packageId: z.uuid("Invalid package ID"),
});
const fulfillmentIdSchema = z.object({
  fulfillmentId: z.uuid("Invalid fulfillment ID"),
});

export async function listReady(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const orders = await listReadyOrders();
  res.status(200).json({ orders });
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = createFulfillmentSchema.safeParse(req.body);
  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const fulfillment = await createFulfillment(result.data);
  res.status(201).json({ message: "Fulfillment created successfully", fulfillment });
}

export async function allocate(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = fulfillmentIdSchema.safeParse(req.params);
  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }
  const bodyResult = allocatePackageSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const pkg = await allocatePackage(paramsResult.data.fulfillmentId, bodyResult.data);
  res.status(201).json({ message: "Package allocated successfully", package: pkg });
}

export async function updateStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = packageIdSchema.safeParse(req.params);
  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }
  const bodyResult = updatePackageStatusSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);
    res.status(400).json({ message: "Validation failed", errors: fieldErrors });
    return;
  }
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const pkg = await updatePackageStatus(paramsResult.data.packageId, bodyResult.data.status);
  res.status(200).json({ message: "Package status updated successfully", package: pkg });
}
