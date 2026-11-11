import { Router } from "express";
import {
  create,
  assignDeliveryController,
  listAssignedDeliveriesController,
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

router.get(
  "/mine",
  authenticate,
  authorize("deliveries.read"),
  listAssignedDeliveriesController,
);

router.post(
  "/",
  authenticate,
  authorize("fulfillment.manage"),
  create,
);

router.patch(
  "/:deliveryId/assignment",
  authenticate,
  authorize("orders.manage"),
  assignDeliveryController,
);

router.patch(
  "/:deliveryId/tracking",
  authenticate,
  authorize("deliveries.manage"),
  updateTracking,
);

router.patch(
  "/:deliveryId/status",
  authenticate,
  authorize("deliveries.manage"),
  updateStatus,
);

router.post(
  "/:deliveryId/attempts",
  authenticate,
  authorize("deliveries.manage"),
  createDeliveryAttemptController,
);

export default router;