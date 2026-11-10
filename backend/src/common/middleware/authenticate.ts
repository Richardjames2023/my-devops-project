import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_ACCESS_SECRET } from "../../config/auth";
import { AppError } from "../errors/AppError";
import type { AuthIdentityType } from "../utils/jwt";

export interface AuthenticatedUser {
  id: string;
  identityType: AuthIdentityType;
  roles: string[];
  permissions: string[];
  sessionVersion?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;

  if (!authorization) {
    next(new AppError("Authentication required", 401));
    return;
  }

  // Accept exactly one Bearer credential. Reject extra values or whitespace
  // rather than silently parsing a different credential than the caller sent.
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match?.[1]) {
    next(new AppError("Invalid authorization header", 401));
    return;
  }

  try {
    const payload = jwt.verify(match[1], JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      (payload.identityType !== undefined &&
        payload.identityType !== "CUSTOMER" &&
        payload.identityType !== "STAFF") ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role: unknown) => typeof role === "string") ||
      !Array.isArray(payload.permissions) ||
      !payload.permissions.every((permission: unknown) => typeof permission === "string") ||
      typeof payload.iat !== "number" ||
      !Number.isFinite(payload.iat) ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      (payload.sessionVersion !== undefined && (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion < 0))
    ) {
      next(new AppError("Invalid access token", 401));
      return;
    }

    req.user = {
      id: payload.sub,
      // Tokens issued before identity separation are treated as customer
      // tokens for backward compatibility; customer middleware verifies the
      // current database role before granting access.
      identityType: payload.identityType ?? "CUSTOMER",
      roles: payload.roles,
      permissions: payload.permissions,
      sessionVersion: typeof payload.sessionVersion === "number" ? payload.sessionVersion : 0,
    };

    next();
  } catch {
    next(new AppError("Invalid or expired access token", 401));
  }
}
