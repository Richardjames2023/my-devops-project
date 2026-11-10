import { Router } from "express";
import { create, expireStaleReservations } from "./inventory.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post(
  "/reservations/expire-stale",
  authenticate,
  authorize("inventory.manage"),
  expireStaleReservations,
);


router.post(
  "/",
  authenticate,
  authorize("inventory.manage"),
  create,
);

export default router;