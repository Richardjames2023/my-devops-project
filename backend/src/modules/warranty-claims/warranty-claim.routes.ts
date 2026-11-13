import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { create, getMine, listAdmin, listMine, review, createGuestClaim, listGuestClaims, getGuestClaim } from "./warranty-claim.controller";

const router = Router();

// Guest after-sales endpoints use the order access token returned at checkout.
router.get("/guest/:orderId", listGuestClaims);
router.post("/guest/:orderId", createGuestClaim);
router.get("/guest/:orderId/:claimId", getGuestClaim);

router.get("/", authenticate, requireCustomer, listMine);
router.post("/", authenticate, requireCustomer, create);
router.get("/admin", authenticate, authorize("warranty.manage"), listAdmin);
router.patch("/:claimId/review", authenticate, authorize("warranty.manage"), review);
router.get("/:claimId", authenticate, requireCustomer, getMine);

export default router;
