import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  createReturnRequestSchema,
  reviewReturnRequestSchema,
  receiveReturnRequestSchema,
  inspectReturnRequestSchema,
} from "./return.validation";

import {
  createReturnRequest,
  receiveReturnRequest,
  reviewReturnRequest,
  inspectReturnRequest,
} from "./return.service";

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

  const result = createReturnRequestSchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const returnRequest = await createReturnRequest(req.user.id, result.data);

  res.status(201).json({
    message: "Return request created successfully",
    returnRequest,
  });
}

export async function review(
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

  const bodyResult = reviewReturnRequestSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const returnRequest = await reviewReturnRequest(
    paramsResult.data.returnRequestId,
    bodyResult.data,
  );

  res.status(200).json({
    message: "Return request reviewed successfully",
    returnRequest,
  });
}

export async function receive(
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

  const bodyResult = receiveReturnRequestSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const returnRequest = await receiveReturnRequest(
    paramsResult.data.returnRequestId,
    bodyResult.data,
  );

  res.status(200).json({
    message: "Return received successfully",
    returnRequest,
  });
}


export async function inspect(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
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

  const bodyResult = inspectReturnRequestSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const returnRequest = await inspectReturnRequest(
    paramsResult.data.returnRequestId,
    req.user.id,
    bodyResult.data,
  );

  res.status(200).json({
    message: "Return inspection recorded successfully",
    returnRequest,
  });
}

