import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  list,
  getById,
  review,
  resolveFulfilled,
  resolveRefunded,
} from "./inventory-reconciliation.controller";

const router = Router();

router.use(authenticate);
router.use(authorize("orders.manage"));

router.get("/", list);
router.get("/:id", getById);
router.patch("/:id/review", review);
router.patch("/:id/resolve-fulfilled", resolveFulfilled);

router.patch("/:id/resolve-refunded", resolveRefunded);

export default router;
