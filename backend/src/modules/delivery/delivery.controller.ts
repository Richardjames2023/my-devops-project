import type { Response } from "express";
import { z } from "zod";
import {
  createDeliverySchema,
  updateDeliveryStatusSchema,
  assignDeliverySchema,
  createDeliveryAttemptSchema,
} from "./delivery.validation";
import {
  createDelivery,
  assignDelivery,
  listAssignedDeliveries,
  updateDeliveryStatus,
  createDeliveryAttempt,
} from "./delivery.service";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";

const deliveryIdSchema = z.object({
  deliveryId: z.uuid("Invalid delivery ID"),
});

export async function listAssignedDeliveriesController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const deliveries = await listAssignedDeliveries(req.user.id);
  res.status(200).json({
    message: "Assigned deliveries retrieved successfully",
    deliveries,
  });
}

export async function assignDeliveryController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = deliveryIdSchema.safeParse(req.params);
  const bodyResult = assignDeliverySchema.safeParse(req.body);

  if (!paramsResult.success || !bodyResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!paramsResult.success ? { deliveryId: ["Invalid delivery ID"] } : {}),
        ...(bodyResult.success ? {} : z.flattenError(bodyResult.error).fieldErrors),
      },
    });
    return;
  }

  const delivery = await assignDelivery(
    paramsResult.data.deliveryId,
    bodyResult.data.staffAccountId,
  );
  res.status(200).json({
    message: "Delivery assigned successfully",
    delivery,
  });
}

export async function create(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = createDeliverySchema.safeParse(req.body);

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });

    return;
  }

  const delivery = await createDelivery(result.data);

  res.status(201).json({
    message: "Delivery created successfully",
    delivery,
  });
}

export async function updateStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = deliveryIdSchema.safeParse(req.params);

  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const bodyResult = updateDeliveryStatusSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });

    return;
  }

  const delivery = await updateDeliveryStatus(
    paramsResult.data.deliveryId,
    bodyResult.data.status,
    {
      staffAccountId: req.user.id,
      canManageAllDeliveries: req.user.permissions.includes("orders.manage"),
    },
  );

  res.status(200).json({
    message: "Delivery status updated successfully",
    delivery,
  });
}

export async function createDeliveryAttemptController(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const paramsResult = deliveryIdSchema.safeParse(req.params);

  if (!paramsResult.success) {
    const { fieldErrors } = z.flattenError(paramsResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  const bodyResult = createDeliveryAttemptSchema.safeParse(req.body);

  if (!bodyResult.success) {
    const { fieldErrors } = z.flattenError(bodyResult.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });

    return;
  }

  if (!req.user) {
    res.status(401).json({
      message: "Authentication required",
    });

    return;
  }

  const result = await createDeliveryAttempt(
    paramsResult.data.deliveryId,
    bodyResult.data,
    {
      staffAccountId: req.user.id,
      canManageAllDeliveries: req.user.permissions.includes("orders.manage"),
    },
  );

  res.status(201).json({
    message: "Delivery attempt recorded successfully",
    ...result,
  });
}
