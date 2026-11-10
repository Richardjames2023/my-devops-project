import type { NextFunction, Response } from "express";
import { AppError } from "../errors/AppError";
import prisma from "../../infrastructure/prisma/client";
import type { AuthenticatedRequest } from "./authenticate";

export async function requireCustomer(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    next(new AppError("Authentication required", 401));
    return;
  }
  if (req.user.identityType !== "CUSTOMER") {
    next(new AppError("This endpoint is available to customer accounts only", 403));
    return;
  }

  try {
    // JWT claims are not sufficient proof of a current customer identity.
    // This also invalidates legacy staff-only tokens that predate identityType.
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isActive: true,
        emailVerified: true,
        sessionVersion: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });

    if (!user || !user.isActive || !user.emailVerified || user.sessionVersion !== (req.user.sessionVersion ?? 0)) {
      next(new AppError("Customer account is inactive, unverified, or unavailable", 403));
      return;
    }

    const roles = user.userRoles.map(({ role }) => role.name);
    if (!roles.includes("CUSTOMER")) {
      next(new AppError("This endpoint is available to customer accounts only", 403));
      return;
    }

    // Keep the request identity aligned with current database state.
    req.user.roles = roles;
    next();
  } catch (error) {
    next(error);
  }
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
