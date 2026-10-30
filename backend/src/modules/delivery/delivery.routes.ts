import { Router } from "express";
import {
  create,
  updateStatus,
  createDeliveryAttemptController,
} from "./delivery.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("orders.manage"),
  create,
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