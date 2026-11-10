import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import {
  create,
  createGuest,
  markSuccessful,
  markGuestSuccessful,
  reconcileUnknown,
  listStalePending,
  reconcileStalePending,
  listStaleWebhookEvents,
  reconcileStaleWebhookEvent,
} from "./payment.controller";
import {
  guestPaymentLimiter,
  guestPaymentVerificationLimiter,
} from "../../common/middleware/rate-limit.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  requireCustomer,
  create,
);

// Guest checkout payment initialization
router.post(
  "/guest",
  guestPaymentLimiter,
  createGuest,
);

router.post(
  "/guest/:paymentId/success",
  guestPaymentVerificationLimiter,
  markGuestSuccessful,
);


router.post(
  "/:paymentId/reconcile-unknown",
  authenticate,
  authorize("orders.manage"),
  reconcileUnknown,
);

router.get(
  "/stale-pending",
  authenticate,
  authorize("orders.manage"),
  listStalePending,
);

router.post(
  "/:paymentId/reconcile-stale-pending",
  authenticate,
  authorize("orders.manage"),
  reconcileStalePending,
);

router.get(
  "/webhooks/stale",
  authenticate,
  authorize("orders.manage"),
  listStaleWebhookEvents,
);

router.post(
  "/webhooks/:eventId/reconcile",
  authenticate,
  authorize("orders.manage"),
  reconcileStaleWebhookEvent,
);

export default router;