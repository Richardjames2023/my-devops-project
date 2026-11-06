import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { createInvitation, listStaff, revokeInvitation, updateInvitationRoles, updateRoles, updateStatus } from "./staff.controller";

const router = Router();
router.use(authenticate, authorize("staff.manage"));
router.post("/invitations", createInvitation);
router.patch("/invitations/:invitationId/roles", updateInvitationRoles);
router.delete("/invitations/:invitationId", revokeInvitation);
router.get("/accounts", listStaff);
router.patch("/accounts/:staffId/roles", updateRoles);
router.patch("/accounts/:staffId/status", updateStatus);
export default router;
