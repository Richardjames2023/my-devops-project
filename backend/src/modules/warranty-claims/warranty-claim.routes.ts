import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireCustomer } from "../../common/middleware/authorize";
import { create, getMine, listAdmin, listMine, review } from "./warranty-claim.controller";

const router = Router();

router.get("/", authenticate, requireCustomer, listMine);
router.post("/", authenticate, requireCustomer, create);
router.get("/admin", authenticate, authorize("warranty.manage"), listAdmin);
router.patch("/:claimId/review", authenticate, authorize("warranty.manage"), review);
router.get("/:claimId", authenticate, requireCustomer, getMine);

export default router;
