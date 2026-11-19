import type { NextFunction, Response } from "express";
import { AppError } from "../../common/errors/AppError";
import {
  authenticate,
  type AuthenticatedRequest,
} from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/identity";
import {
  requireGuestSession,
  type GuestSessionRequest,
} from "../guest-session/guest-session.middleware";
import type { ChatOwner } from "./chat.types";

type ChatRequest = AuthenticatedRequest & GuestSessionRequest & {
  chatOwner?: ChatOwner;
};

/**
 * Customer bearer authentication takes precedence when supplied. Otherwise,
 * the existing guest-session cookie is required and validated.
 */
export function resolveChatOwner(
  req: ChatRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.headers.authorization !== undefined) {
    authenticate(req, res, (authenticationError) => {
      if (authenticationError) {
        next(authenticationError);
        return;
      }

      void requireCustomer(req, res, (customerError) => {
        if (customerError) {
          next(customerError);
          return;
        }
        if (!req.user) {
          next(new AppError("Authentication required", 401));
          return;
        }

        req.chatOwner = { type: "CUSTOMER", id: req.user.id };
        next();
      });
    });
    return;
  }

  void requireGuestSession(req, res, (guestError) => {
    if (guestError) {
      next(guestError);
      return;
    }
    if (!req.guestSessionId) {
      next(new AppError("Guest session required", 401));
      return;
    }

    req.chatOwner = { type: "GUEST", id: req.guestSessionId };
    next();
  });
}
