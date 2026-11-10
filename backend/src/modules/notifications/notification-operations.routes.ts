import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize, requireStaff } from "../../common/middleware/authorize";
import {
  getDeadEmailDeliveries,
  getDeadOutbox,
  retryEmailDelivery,
  retryOutboxEvent,
} from "./notification-operations.controller";

const router = Router();
router.use(authenticate, requireStaff, authorize("settings.manage"));

router.get("/outbox/dead", getDeadOutbox);
router.post("/outbox/:id/retry", retryOutboxEvent);
router.get("/email/dead", getDeadEmailDeliveries);
router.post("/email/:id/retry", retryEmailDelivery);

export default router;
