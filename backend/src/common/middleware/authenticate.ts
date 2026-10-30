import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_ACCESS_SECRET } from "../../config/auth";
import { AppError } from "../errors/AppError";

export interface AuthenticatedUser {
  id: string;
  roles: string[];
  permissions: string[];
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
    next(
      new AppError(
        "Authentication required",
        401,
      ),
    );
    return;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    next(
      new AppError(
        "Invalid authorization header",
        401,
      ),
    );
    return;
  }

  try {
    const payload = jwt.verify(
      token,
      JWT_ACCESS_SECRET,
    );

    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.sub !== "string" ||
      !Array.isArray(payload.roles) ||
      !Array.isArray(payload.permissions)
    ) {
      next(
        new AppError(
          "Invalid access token",
          401,
        ),
      );
      return;
    }

    req.user = {
      id: payload.sub,
      roles: payload.roles.filter(
        (role): role is string =>
          typeof role === "string",
      ),
      permissions: payload.permissions.filter(
        (permission): permission is string =>
          typeof permission === "string",
      ),
    };

    next();
  } catch {
    next(
      new AppError(
        "Invalid or expired access token",
        401,
      ),
    );
  }
}