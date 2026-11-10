import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import { getPreferences, updatePreference } from "./notification-preferences.controller";

const router = Router();
router.use(authenticate, requireCustomer);
router.get("/", getPreferences);
router.put("/:category", updatePreference);

export default router;
