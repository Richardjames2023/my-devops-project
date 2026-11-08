import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireStaff } from "../../common/middleware/authorize";
import { getInbox, markAllRead, markRead } from "./notification-inbox.controller";
import { requireActiveStaffInbox } from "./notification-inbox.middleware";

const router = Router();
router.use(authenticate, requireStaff, requireActiveStaffInbox);
router.get("/", getInbox);
router.patch("/read-all", markAllRead);
router.patch("/:notificationId/read", markRead);

export default router;
