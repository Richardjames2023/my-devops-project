import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { createRefundSchema, retryRefundSchema } from "./refund.validation";
import {
  createRefund,
  reconcileRefund,
  retryRefundWithCustomerDetails,
} from "./refund.service";

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });
    return;
  }

  const paramsSchema = z.object({
    returnRequestId: z.uuid("Invalid return request ID"),
  });

  const paramsResult = paramsSchema.safeParse(req.params);

  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const bodyResult = createRefundSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const refund = await createRefund(
    paramsResult.data.returnRequestId,
    bodyResult.data,
  );

  res.status(201).json({
    message: "Refund record created successfully",
    refund,
  });
}

export async function reconcile(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsSchema = z.object({
    refundId: z.uuid("Invalid refund ID"),
  });

  const paramsResult = paramsSchema.safeParse(req.params);

  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const refund = await reconcileRefund(paramsResult.data.refundId);

  res.status(200).json({
    message: "Refund status reconciled successfully",
    refund,
  });
}

export async function retryWithCustomerDetails(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = z
    .object({
      refundId: z.uuid("Invalid refund ID"),
    })
    .safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      message: "Invalid refund ID",
      errors: z.flattenError(paramsResult.error).fieldErrors,
    });
    return;
  }

  const bodyResult = retryRefundSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(bodyResult.error).fieldErrors,
    });
    return;
  }

  const refund = await retryRefundWithCustomerDetails(
    paramsResult.data.refundId,
    bodyResult.data,
  );

  res.status(200).json({
    message:
      "Refund retry submitted; reconcile the provider status if necessary",
    refund,
  });
}
