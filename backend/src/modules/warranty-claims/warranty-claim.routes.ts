import { Router } from "express";
import { guestOrderLimiter, guestOrderRetrievalLimiter } from "../../common/middleware/rate-limit.middleware";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { create, getMine, listAdmin, listMine, review, createGuestClaim, listGuestClaims, getGuestClaim } from "./warranty-claim.controller";

const router = Router();

// Guest after-sales endpoints use the order access token returned at checkout.
router.get("/guest/:orderId", guestOrderRetrievalLimiter, listGuestClaims);
router.post("/guest/:orderId", guestOrderLimiter, createGuestClaim);
router.get("/guest/:orderId/:claimId", guestOrderRetrievalLimiter, getGuestClaim);

router.get("/", authenticate, requireCustomer, listMine);
router.post("/", authenticate, requireCustomer, create);
router.get("/admin", authenticate, authorize("warranty.manage"), listAdmin);
router.patch("/:claimId/review", authenticate, authorize("warranty.manage"), review);
router.get("/:claimId", authenticate, requireCustomer, getMine);

export default router;
