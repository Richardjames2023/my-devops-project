import { Router } from "express";
import { acceptInvitation, exchangeInvitation, login, refresh, me } from "./staff-auth.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { requireStaff } from "../../common/middleware/authorize";
import { loginLimiter, refreshLimiter, registrationLimiter } from "../../common/middleware/rate-limit.middleware";

const router = Router();
router.post("/invitation/exchange", registrationLimiter, exchangeInvitation);
router.post("/accept-invitation", registrationLimiter, acceptInvitation);
router.post("/login", loginLimiter, login);
router.post("/refresh", refreshLimiter, refresh);
router.get("/me", authenticate, requireStaff, me);
export default router;
