import type { Response } from "express";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  listReconciliationsSchema,
  reconciliationIdSchema,
  reviewReconciliationSchema,
  resolveReconciliationSchema,
} from "./inventory-reconciliation.validation";

import {
  listReconciliations,
  getReconciliationById,
  markReconciliationUnderReview,
  resolveReconciliationAsFulfilled,
} from "./inventory-reconciliation.service";

export async function list(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });
    return;
  }

  const result = listReconciliationsSchema.safeParse(req.query);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: result.error.flatten().fieldErrors,
    });
    return;
  }

  const data = await listReconciliations(result.data);

  res.status(200).json({
    message: "Inventory reconciliation records retrieved successfully",
    ...data,
  });
}

export async function getById(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });
    return;
  }

  const result = reconciliationIdSchema.safeParse(req.params);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: result.error.flatten().fieldErrors,
    });
    return;
  }

  const reconciliation = await getReconciliationById(
    result.data.id,
  );

  res.status(200).json({
    message: "Inventory reconciliation record retrieved successfully",
    reconciliation,
  });
}

export async function review(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = reconciliationIdSchema.safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: paramsResult.error.flatten().fieldErrors,
    });
    return;
  }

  const bodyResult = reviewReconciliationSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: bodyResult.error.flatten().fieldErrors,
    });
    return;
  }

  const reconciliation = await markReconciliationUnderReview(
    paramsResult.data.id,
    req.user.id,
    bodyResult.data,
    {
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(req.get("user-agent")
        ? { userAgent: req.get("user-agent")! }
        : {}),
    },
  );

  res.status(200).json({
    message: "Inventory reconciliation moved under review successfully",
    reconciliation,
  });
}

export async function resolveFulfilled(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = reconciliationIdSchema.safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: paramsResult.error.flatten().fieldErrors,
    });
    return;
  }

  const bodyResult = resolveReconciliationSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: bodyResult.error.flatten().fieldErrors,
    });
    return;
  }

  const result = await resolveReconciliationAsFulfilled(
    paramsResult.data.id,
    req.user.id,
    bodyResult.data.notes,
    {
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(req.get("user-agent")
        ? { userAgent: req.get("user-agent")! }
        : {}),
    },
  );

  res.status(200).json({
    message: "Inventory reconciliation resolved through fulfilment",
    ...result,
  });
}
