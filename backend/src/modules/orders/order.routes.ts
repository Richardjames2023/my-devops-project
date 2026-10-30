import { Router } from "express";
import { create } from "./order.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("orders.create"),
  create,
);

export default router;