import { Router } from "express";
import {
  register,
  login,
  refresh,
  getMe,
} from "./auth.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import {
  registrationLimiter,
  loginLimiter,
  refreshLimiter,
} from "../../common/middleware/rate-limit.middleware";

const router = Router();

router.post("/register", registrationLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/refresh", refreshLimiter, refresh);

router.get("/me", authenticate, requireCustomer, getMe);

export default router;
