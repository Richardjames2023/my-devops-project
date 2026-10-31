import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  create,
  createGuest,
  markSuccessful,
  markGuestSuccessful,
  listStaleWebhookEvents,
  reconcileStaleWebhookEvent,
} from "./payment.controller";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("orders.create"),
  create,
);

// Guest checkout payment initialization
router.post("/guest", createGuest);

router.post(
  "/:paymentId/success",
  authenticate,
  authorize("orders.create"),
  markSuccessful,
);

router.post(
  "/guest/:paymentId/success",
  markGuestSuccessful,
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