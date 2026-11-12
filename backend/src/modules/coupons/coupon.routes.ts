import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { create, getById, list, update } from "./coupon.controller";

const router = Router();

router.use(authenticate, authorize("coupons.manage"));
router.get("/", list);
router.post("/", create);
router.get("/:couponId", getById);
router.patch("/:couponId", update);

export default router;
