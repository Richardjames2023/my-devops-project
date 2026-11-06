import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  create,
  listMine,
  getMine,
  listAdmin,
  review,
  resolve,
} from "./warranty.controller";

const router = Router();

// Customer claim submission and personal claim history.
router.post("/claims", authenticate, create);
router.get("/claims", authenticate, listMine);
router.get("/claims/:claimId", authenticate, getMine);

// Staff workflows require explicit order-management permission.
router.get("/admin/claims", authenticate, authorize("orders.manage"), listAdmin);
router.patch("/admin/claims/:claimId/review", authenticate, authorize("orders.manage"), review);
router.patch("/admin/claims/:claimId/resolve", authenticate, authorize("orders.manage"), resolve);

export default router;
