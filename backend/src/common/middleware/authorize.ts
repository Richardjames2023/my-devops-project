import type { NextFunction, Response } from "express";
import { AppError } from "../errors/AppError";
import type { AuthenticatedRequest } from "./authenticate";
import prisma from "../../infrastructure/prisma/client";

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

export function authorize(permission: string) {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.user) {
      next(new AppError("Authentication required", 401));
      return;
    }

    if (req.user.identityType !== "STAFF") {
      next(new AppError("A staff account is required", 403));
      return;
    }

    try {
      // Resolve current roles and permissions on every protected staff request.
      // This makes role revocation effective immediately instead of waiting
      // for an access token to expire.
      const staff = await prisma.staffAccount.findUnique({
        where: { id: req.user.id },
        select: {
          status: true,
          roles: {
            select: {
              role: {
                select: {
                  name: true,
                  permissions: {
                    select: { permission: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      });

      if (!staff || staff.status !== "ACTIVE") {
        next(new AppError("Staff account is inactive", 403));
        return;
      }

      const roles = staff.roles.map(({ role }) => role.name);
      const permissions = [...new Set(staff.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.name),
      ))];

      req.user.roles = roles;
      req.user.permissions = permissions;

      if (!permissions.includes(permission)) {
        next(new AppError("You do not have permission to perform this action", 403));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
