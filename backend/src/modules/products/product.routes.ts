import { Router } from "express";
import {
  create,
  getAdminById,
  getBySlug,
  list,
  listAdmin,
  remove,
  update,
  updateStatus,
} from "./product.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

// Public storefront endpoints.
router.get("/", list);

// Keep fixed admin paths before the public slug parameter route.
router.get("/admin", authenticate, authorize("products.manage"), listAdmin);
router.get("/admin/:productId", authenticate, authorize("products.manage"), getAdminById);

// Product administration.
router.post("/", authenticate, authorize("products.manage"), create);
router.patch("/:productId", authenticate, authorize("products.manage"), update);
router.patch("/:productId/status", authenticate, authorize("products.manage"), updateStatus);
router.delete("/:productId", authenticate, authorize("products.manage"), remove);

// Public product details.
router.get("/:slug", getBySlug);

export default router;
