import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { staffOrderListQuerySchema } from "./staff-order.validation";
import { getStaffOrder, listStaffOrders } from "./staff-order.service";

const orderIdSchema = z.uuid("Invalid order ID");

export async function list(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const result = staffOrderListQuerySchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const resultSet = await listStaffOrders(result.data);
  res.status(200).json({
    message: "Orders retrieved successfully",
    ...resultSet,
  });
}

export async function get(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const orderIdResult = orderIdSchema.safeParse(req.params.orderId);
  if (!orderIdResult.success) {
    throw new AppError("Invalid order ID", 400);
  }

  const order = await getStaffOrder(orderIdResult.data);
  res.status(200).json({
    message: "Order retrieved successfully",
    order,
  });
}
