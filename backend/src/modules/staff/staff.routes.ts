import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { createInvitation, listInvitations, listRoles, listStaff, resendInvitation, revokeInvitation, updateInvitationRoles, updateRoles, updateStatus } from "./staff.controller";

const router = Router();
router.use(authenticate);
router.get("/roles", authorize("staff.read"), listRoles);
router.get("/invitations", authorize("staff.read"), listInvitations);
router.get("/accounts", authorize("staff.read"), listStaff);
router.post("/invitations", authorize("staff.manage"), createInvitation);
router.post("/invitations/:invitationId/resend", authorize("staff.manage"), resendInvitation);
router.patch("/invitations/:invitationId/roles", authorize("staff.manage"), updateInvitationRoles);
router.delete("/invitations/:invitationId", authorize("staff.manage"), revokeInvitation);
router.patch("/accounts/:staffId/roles", authorize("staff.manage"), updateRoles);
router.patch("/accounts/:staffId/status", authorize("staff.manage"), updateStatus);
export default router;
