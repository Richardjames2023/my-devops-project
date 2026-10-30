
import { Router } from "express";
import { create, reconcile,  retryWithCustomerDetails, } from "./refund.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/:returnRequestId",
  authenticate,
  authorize("orders.manage"),
  create,
);

router.patch(
  "/:refundId/reconcile",
  authenticate,
  authorize("orders.manage"),
  reconcile,
);


router.post(
  "/:refundId/retry",
  authenticate,
  authorize("orders.manage"),
  retryWithCustomerDetails,
);

export default router;
