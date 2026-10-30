
import { Router } from "express";
import {
  endGuestSession,
  getGuestSessionStatus,
  startGuestSession,
} from "./guest-session.controller";

const router = Router();

router.post("/", startGuestSession);
router.get("/status", getGuestSessionStatus);
router.delete("/", endGuestSession);

export default router;
