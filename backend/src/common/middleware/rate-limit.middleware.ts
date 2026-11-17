import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";

const rateLimitMessage = (message: string) => ({ message });

function wishlistRateLimitKey(req: Request): string {
  const customerId = (req as Request & { user?: { id: string } }).user?.id;
  return customerId ?? ipKeyGenerator(req.ip ?? "");
}

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

export const accountDeletionCancellationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many cancellation attempts. Please try again later."),
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many token refresh attempts. Please try again later."),
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many password reset requests. Please try again later."),
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many password reset attempts. Please try again later."),
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


// Customer wishlist access
export const wishlistReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: wishlistRateLimitKey,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many wishlist requests. Please try again later."),
});

export const wishlistMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: wishlistRateLimitKey,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitMessage("Too many wishlist changes. Please try again later."),
});
