import { Router } from "express";
import { allocate, create, listReady, updateStatus } from "./fulfillment.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.get("/ready-orders", authenticate, authorize("fulfillment.read"), listReady);
router.post("/", authenticate, authorize("fulfillment.manage"), create);
router.post(
  "/:fulfillmentId/packages",
  authenticate,
  authorize("fulfillment.manage"),
  allocate,
);
router.patch(
  "/packages/:packageId/status",
  authenticate,
  authorize("fulfillment.manage"),
  updateStatus,
);

export default router;
