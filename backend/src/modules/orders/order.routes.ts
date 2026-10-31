import { Router } from "express";
import {
  create,
  createGuest,
} from "./order.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { requireGuestSession } from "../guest-session/guest-session.middleware";

const router = Router();

// Registered customer checkout
router.post(
  "/",
  authenticate,
  authorize("orders.create"),
  create,
);

// Guest checkout
router.post(
  "/guest",
  requireGuestSession,
  createGuest,
);

export default router;
