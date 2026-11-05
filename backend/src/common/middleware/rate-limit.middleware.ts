import { rateLimit } from "express-rate-limit";

const rateLimitMessage = (message: string) => ({ message });

// Authentication
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many registration attempts. Please try again later."),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many login attempts. Please try again later."),
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many token refresh attempts. Please try again later."),
});

// Guest session creation
export const guestSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many requests. Please try again later."),
});

// Guest order creation
export const guestOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many checkout attempts. Please try again later."),
});

// Guest order retrieval
export const guestOrderRetrievalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many order retrieval requests. Please try again later."),
});

// Guest payment initialization
export const guestPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many payment attempts. Please try again later."),
});

// Guest payment verification
export const guestPaymentVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many payment verification attempts. Please try again later."),
});
