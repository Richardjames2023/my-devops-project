import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  claimStaffChatConversationController,
  getStaffChatConversationController,
  listStaffChatConversationsController,
} from "./staff-chat.controller";

const router = Router();

router.use(authenticate);

router.get(
  "/conversations",
  authorize("chat.read"),
  listStaffChatConversationsController,
);
router.get(
  "/conversations/:conversationId",
  authorize("chat.read"),
  getStaffChatConversationController,
);
router.post(
  "/conversations/:conversationId/assign",
  authorize("chat.assign"),
  claimStaffChatConversationController,
);

export default router;
