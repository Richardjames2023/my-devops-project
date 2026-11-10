
import { Router } from "express";
import { create, reconcile,  retryWithCustomerDetails, } from "./refund.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/:returnRequestId",
  authenticate,
  authorize("refunds.manage"),
  create,
);

router.patch(
  "/:refundId/reconcile",
  authenticate,
  authorize("refunds.manage"),
  reconcile,
);


router.post(
  "/:refundId/retry",
  authenticate,
  authorize("refunds.manage"),
  retryWithCustomerDetails,
);

export default router;
