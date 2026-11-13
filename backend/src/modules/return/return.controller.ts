import type { Request, Response } from "express";
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
  listCustomerReturnRequests,
  getCustomerReturnRequest,
  listGuestReturnRequests,
  getGuestReturnRequest,
} from "./return.service";
import { customerReturnHistoryQuerySchema } from "./return-history.validation";
import { isValidGuestOrderAccessToken } from "../orders/guest-order-access";

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



export async function listMine(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const queryResult = customerReturnHistoryQuerySchema.safeParse(req.query);

  if (!queryResult.success) {
    const { fieldErrors } = z.flattenError(queryResult.error);
    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const result = await listCustomerReturnRequests(req.user.id, queryResult.data);

  res.status(200).json({
    message: "Customer return history retrieved successfully",
    ...result,
  });
}

 
export async function getMine(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = z.object({
    returnRequestId: z.uuid("Invalid return request ID"),
  }).safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(paramsResult.error).fieldErrors,
    });
    return;
  }

  const returnRequest = await getCustomerReturnRequest(
    req.user.id,
    paramsResult.data.returnRequestId,
  );

  res.status(200).json({
    message: "Return request retrieved successfully",
    returnRequest,
  });
}


function readGuestOrderCredentials(req: Request, res: Response): { orderId: string; token: string } | null {
  const params = z.object({ orderId: z.uuid("Invalid order ID") }).safeParse(req.params);
  const token = req.get("x-guest-order-token");
  if (!params.success || !isValidGuestOrderAccessToken(token)) {
    res.status(404).json({ message: "Order not found" });
    return null;
  }
  return { orderId: params.data.orderId, token };
}

export async function createGuestReturn(req: Request, res: Response): Promise<void> {
  const credentials = readGuestOrderCredentials(req, res);
  if (!credentials) return;
  const parsed = createReturnRequestSchema.safeParse({ ...req.body, orderId: credentials.orderId });
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const returnRequest = await createReturnRequest(null, parsed.data, credentials.token);
  res.status(201).json({ message: "Guest return request created successfully", returnRequest });
}

export async function listGuestReturns(req: Request, res: Response): Promise<void> {
  const credentials = readGuestOrderCredentials(req, res);
  if (!credentials) return;
  const result = await listGuestReturnRequests(credentials.orderId, credentials.token);
  res.status(200).json({ message: "Guest return history retrieved successfully", ...result });
}

export async function getGuestReturn(req: Request, res: Response): Promise<void> {
  const params = z.object({
    orderId: z.uuid("Invalid order ID"),
    returnRequestId: z.uuid("Invalid return request ID"),
  }).safeParse(req.params);
  const token = req.get("x-guest-order-token");
  if (!params.success || !isValidGuestOrderAccessToken(token)) {
    res.status(404).json({ message: "Return request not found" });
    return;
  }
  const returnRequest = await getGuestReturnRequest(
    params.data.orderId,
    params.data.returnRequestId,
    token,
  );
  res.status(200).json({ message: "Guest return request retrieved successfully", returnRequest });
}
