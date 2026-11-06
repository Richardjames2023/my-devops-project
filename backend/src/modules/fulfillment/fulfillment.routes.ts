import { Router } from "express";
import { allocate, create, updateStatus } from "./fulfillment.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post("/", authenticate, authorize("orders.manage"), create);
router.post(
  "/:fulfillmentId/packages",
  authenticate,
  authorize("orders.manage"),
  allocate,
);
router.patch(
  "/packages/:packageId/status",
  authenticate,
  authorize("orders.manage"),
  updateStatus,
);

export default router;
