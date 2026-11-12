import { Router } from "express";
import { adjust, create } from "./stock-movement.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/adjustments",
  authenticate,
  authorize("inventory.manage"),
  adjust,
);

router.post(
  "/",
  authenticate,
  authorize("inventory.manage"),
  create,
);

export default router;
