import type { NextFunction, Response } from "express";
import { AppError } from "../errors/AppError";
import type { AuthenticatedRequest } from "./authenticate";

export function requireCustomer(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(new AppError("Authentication required", 401));
    return;
  }
  if (req.user.identityType !== "CUSTOMER") {
    next(new AppError("This endpoint is available to customer accounts only", 403));
    return;
  }
  next();
}

export function requireStaff(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(new AppError("Authentication required", 401));
    return;
  }
  if (req.user.identityType !== "STAFF") {
    next(new AppError("A staff account is required", 403));
    return;
  }
  next();
}
