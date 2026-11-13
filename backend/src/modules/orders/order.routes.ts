import { Router } from "express";
import {
  create,
  createGuest,
  getGuest,
  revokeGuest,
  cancel,
  adminCancel,
  listMine,
} from "./order.controller";
import {
  guestOrderLimiter,
  guestOrderRetrievalLimiter,
} from "../../common/middleware/rate-limit.middleware";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { requireGuestSession } from "../guest-session/guest-session.middleware";

const router = Router();

// Registered customer order history
router.get("/", authenticate, requireCustomer, listMine);

// Registered customer checkout
router.post(
  "/",
  authenticate,
  requireCustomer,
  create,
);

// Registered customer order cancellation
router.patch(
  "/:orderId/cancel",
  authenticate,
  requireCustomer,
  cancel,
);

// Admin order cancellation
router.patch(
  "/:orderId/admin-cancel",
  authenticate,
  authorize("orders.manage"),
  adminCancel,
);

// Guest checkout
router.post(
  "/guest",
  guestOrderLimiter,
  requireGuestSession,
  createGuest,
);

// Guest order access revocation
router.post(
  "/guest/:orderId/access/revoke",
  guestOrderRetrievalLimiter,
  revokeGuest,
);

// Guest order retrieval
router.get(
  "/guest/:orderId",
  guestOrderRetrievalLimiter,
  getGuest,
);

export default router;
