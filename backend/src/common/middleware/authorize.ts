import type { NextFunction, Response } from "express";
import { AppError } from "../errors/AppError";
import type { AuthenticatedRequest } from "./authenticate";

export function authorize(permission: string) {
  return (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user) {
      next(
        new AppError(
          "Authentication required",
          401,
        ),
      );
      return;
    }

    const hasPermission =
      req.user.permissions.includes(permission);

    if (!hasPermission) {
      next(
        new AppError(
          "You do not have permission to perform this action",
          403,
        ),
      );
      return;
    }

    next();
  };
}