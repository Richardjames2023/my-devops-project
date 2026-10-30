import { Router } from "express";
import { create } from "./product-variant.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("products.manage"),
  create,
);

export default router;