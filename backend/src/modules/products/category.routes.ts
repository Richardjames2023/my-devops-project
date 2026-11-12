import { Router } from "express";
import {
  create,
  list,
  listAdmin,
  remove,
  update,
  updateStatus,
} from "./category.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

// Public storefront endpoint.
router.get("/", list);

// Category administration.
router.get("/admin", authenticate, authorize("categories.manage"), listAdmin);
router.post("/", authenticate, authorize("categories.manage"), create);
router.patch("/:categoryId", authenticate, authorize("categories.manage"), update);
router.patch("/:categoryId/status", authenticate, authorize("categories.manage"), updateStatus);
router.delete("/:categoryId", authenticate, authorize("categories.manage"), remove);

export default router;
