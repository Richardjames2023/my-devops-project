import { Router } from "express";
import {
  create,
  remove,
  update,
  updateStatus,
} from "./product-variant.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post("/", authenticate, authorize("products.manage"), create);
router.patch("/:variantId", authenticate, authorize("products.manage"), update);
router.patch("/:variantId/status", authenticate, authorize("products.manage"), updateStatus);
router.delete("/:variantId", authenticate, authorize("products.manage"), remove);

export default router;
