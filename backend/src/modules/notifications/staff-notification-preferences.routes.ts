import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireStaff } from "../../common/middleware/authorize";
import { requireActiveStaffInbox } from "./notification-inbox.middleware";
import { getPreferences, updatePreference } from "./notification-preferences.controller";

const router = Router();
router.use(authenticate, requireStaff, requireActiveStaffInbox);
router.get("/", getPreferences);
router.put("/:category", updatePreference);

export default router;
