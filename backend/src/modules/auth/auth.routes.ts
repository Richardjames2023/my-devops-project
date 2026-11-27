import { Router } from "express";
import { googleSignIn, facebookSignIn } from "./social-auth.controller";
import {
  register,
  login,
  refresh,
  getMe,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
} from "./auth.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import {
  registrationLimiter,
  loginLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from "../../common/middleware/rate-limit.middleware";

const router = Router();

router.post("/register", registrationLimiter, register);
router.post("/verify-email", registrationLimiter, verifyEmail);
router.post("/verify-email/resend", registrationLimiter, resendVerificationEmail);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
router.post("/login", loginLimiter, login);
router.post("/google", loginLimiter, googleSignIn);
router.post("/facebook", loginLimiter, facebookSignIn);
router.post("/refresh", refreshLimiter, refresh);

router.get("/me", authenticate, requireCustomer, getMe);

export default router;
