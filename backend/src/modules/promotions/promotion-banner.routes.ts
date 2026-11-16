import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { create, getById, list, putDefault, remove, removeDefault, storefront, update } from "./promotion-banner.controller";
import { uploadPromotionBanner } from "./promotion-banner.upload";

const router = Router();
const staff = [authenticate, authorize("promotions.manage")];

router.get("/public", storefront);
router.get("/", ...staff, list);
router.post("/", ...staff, uploadPromotionBanner, create);
router.get("/:bannerId", ...staff, getById);
router.patch("/:bannerId", ...staff, uploadPromotionBanner, update);
router.delete("/:bannerId", ...staff, remove);
router.put("/defaults/:position", ...staff, uploadPromotionBanner, putDefault);
router.delete("/defaults/:position", ...staff, removeDefault);

export default router;
