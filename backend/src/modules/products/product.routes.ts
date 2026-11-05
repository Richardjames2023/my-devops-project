import { Router } from "express";
import { create, getBySlug, list } from "./product.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

// Public storefront endpoints.
router.get("/", list);
router.get("/:slug", getBySlug);

// Product administration.
router.post("/", authenticate, authorize("products.manage"), create);

export default router;
