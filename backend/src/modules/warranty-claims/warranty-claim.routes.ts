import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { create, getMine, listAdmin, listMine, review } from "./warranty-claim.controller";

const router = Router();

router.get("/", authenticate, listMine);
router.post("/", authenticate, create);
router.get("/admin", authenticate, authorize("orders.manage"), listAdmin);
router.patch("/:claimId/review", authenticate, authorize("orders.manage"), review);
router.get("/:claimId", authenticate, getMine);

export default router;
