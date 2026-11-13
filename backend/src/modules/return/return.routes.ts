import { Router } from "express";
import { guestOrderLimiter, guestOrderRetrievalLimiter } from "../../common/middleware/rate-limit.middleware";
import {
  listMine,
  getMine,
  create,
  receive,
  review,
  inspect,
  createGuestReturn,
  listGuestReturns,
  getGuestReturn,
} from "./return.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { uploadEvidence } from "./return-evidence.controller";
import { uploadReturnEvidence } from "./return-evidence.upload";
import { viewEvidence } from "./return-evidence-view.controller";
import { streamEvidenceFile } from "./return-evidence-file.controller";

const router = Router();

// Guest after-sales endpoints use the order access token returned at checkout.
router.get("/guest/:orderId", guestOrderRetrievalLimiter, listGuestReturns);
router.post("/guest/:orderId", guestOrderLimiter, createGuestReturn);
router.get("/guest/:orderId/:returnRequestId", guestOrderRetrievalLimiter, getGuestReturn);

router.get("/", authenticate, requireCustomer, listMine);
router.get("/:returnRequestId", authenticate, requireCustomer, getMine);

router.post(
  "/",
  authenticate,
  requireCustomer,
  create,
);

router.patch(
  "/:returnRequestId/review",
  authenticate,
  authorize("returns.manage"),
  review,
);

router.patch(
  "/:returnRequestId/receive",
  authenticate,
  authorize("returns.manage"),
  receive,
);

router.patch(
  "/:returnRequestId/inspect",
  authenticate,
  authorize("inventory.manage"),
  inspect,
);

router.post(
  "/:returnRequestId/evidence",
  authenticate,
  requireCustomer,
  uploadReturnEvidence,
  uploadEvidence,
);

router.get(
  "/evidence/:evidenceId/view",
  authenticate,
  requireCustomer,
  viewEvidence,
);

router.get(
  "/evidence/:evidenceId/file",
  authenticate,
  requireCustomer,
  streamEvidenceFile,
);

export default router;