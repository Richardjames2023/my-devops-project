import type { NextFunction, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import prisma from "../../infrastructure/prisma/client";

/**
 * requireStaff verifies the token identity. Inbox access additionally checks
 * current account status so suspended/deactivated staff lose access immediately.
 */
export async function requireActiveStaffInbox(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    next(new AppError("Authentication required", 401));
    return;
  }

  if (req.user.identityType !== "STAFF") {
    next(new AppError("A staff account is required", 403));
    return;
  }

  try {
    const staff = await prisma.staffAccount.findUnique({
      where: { id: req.user.id },
      select: { status: true },
    });

    if (!staff || staff.status !== "ACTIVE") {
      next(new AppError("Staff account is inactive", 403));
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
