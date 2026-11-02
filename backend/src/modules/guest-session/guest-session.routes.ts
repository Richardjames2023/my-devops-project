
import { Router } from "express";
import {
  endGuestSession,
  getGuestSessionStatus,
  startGuestSession,
} from "./guest-session.controller";
import { guestSessionLimiter } from "../../common/middleware/rate-limit.middleware";

const router = Router();

router.post(
  "/",
  guestSessionLimiter,
  startGuestSession,
);
router.get("/status", getGuestSessionStatus);
router.delete("/", endGuestSession);

export default router;
