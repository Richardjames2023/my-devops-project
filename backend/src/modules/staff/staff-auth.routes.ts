import { Router } from "express";
import { acceptInvitation, login, refresh, me } from "./staff-auth.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { requireStaff } from "../../common/middleware/authorize";
import { loginLimiter, refreshLimiter } from "../../common/middleware/rate-limit.middleware";

const router = Router();
router.post("/accept-invitation", acceptInvitation);
router.post("/login", loginLimiter, login);
router.post("/refresh", refreshLimiter, refresh);
router.get("/me", authenticate, requireStaff, me);
export default router;
