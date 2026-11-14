import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/identity";
import { loginLimiter } from "../../common/middleware/rate-limit.middleware";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
  updateProfile,
} from "./customer-profile.controller";

const router = Router();

router.patch("/profile", authenticate, requireCustomer, updateProfile);
router.post("/account/deletion-request", authenticate, requireCustomer, requestAccountDeletion);
// The account is immediately deactivated when deletion is requested, so cancellation
// deliberately uses password re-authentication rather than a now-invalid access token.
router.post("/account/deletion-request/cancel", loginLimiter, cancelAccountDeletion);

export default router;
