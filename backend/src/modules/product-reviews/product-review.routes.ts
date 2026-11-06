import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  create,
  eligibility,
  listForProduct,
  listPending,
  moderate,
  updateMine,
} from "./product-review.controller";

const router = Router();

router.get("/products/:productId", listForProduct);
router.get("/products/:productId/eligibility", authenticate, eligibility);
router.post("/products/:productId", authenticate, create);
router.patch("/products/:productId/mine", authenticate, updateMine);

router.get("/admin/pending", authenticate, authorize("products.manage"), listPending);
router.patch("/:reviewId/moderation", authenticate, authorize("products.manage"), moderate);

export default router;
