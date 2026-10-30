import { Router } from "express";
import { create, confirm, release, } from "./inventory-reservation.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("inventory.manage"),
  create,
);

router.post(
  "/:reservationId/confirm",
  authenticate,
  authorize("inventory.manage"),
  confirm,
);

router.post(
  "/:reservationId/release",
  authenticate,
  authorize("inventory.manage"),
  release,
);

export default router;