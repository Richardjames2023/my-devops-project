import { Router } from "express";
import {
  create,
  updateStatus,
  createDeliveryAttemptController,
} from "./delivery.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { guestOrderRetrievalLimiter } from "../../common/middleware/rate-limit.middleware";
import {
  updateTracking,
  getCustomerTracking,
  getGuestTracking,
} from "./delivery-tracking.controller";

const router = Router();

// Customer tracking: ownership is checked against the authenticated user.
router.get("/orders/:orderId/tracking", authenticate, requireCustomer, getCustomerTracking);

// Guest tracking requires the original high-entropy guest order token.
router.get(
  "/guest/orders/:orderId/tracking",
  guestOrderRetrievalLimiter,
  getGuestTracking,
);

router.post(
  "/",
  authenticate,
  authorize("orders.manage"),
  create,
);

router.patch(
  "/:deliveryId/tracking",
  authenticate,
  authorize("orders.manage"),
  updateTracking,
);

router.patch(
  "/:deliveryId/status",
  authenticate,
  authorize("orders.manage"),
  updateStatus,
);

router.post(
  "/:deliveryId/attempts",
  authenticate,
  authorize("orders.manage"),
  createDeliveryAttemptController,
);

export default router;