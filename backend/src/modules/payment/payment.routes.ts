import { Router } from "express";

import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { create, markSuccessful, listStaleWebhookEvents, reconcileStaleWebhookEvent, } from "./payment.controller";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("orders.create"),
  create,
);

router.post(
  "/:paymentId/success",
  authenticate,
  authorize("orders.create"),
  markSuccessful,
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