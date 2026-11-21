import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  claimStaffChatConversationController,
  closeStaffChatConversationController,
  getStaffChatConversationController,
  listStaffChatConversationsController,
  listStaffChatRealtimeEventsController,
  sendStaffChatMessageController,
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
router.get(
  "/conversations/:conversationId/events",
  authorize("chat.read"),
  listStaffChatRealtimeEventsController,
);
router.post(
  "/conversations/:conversationId/assign",
  authorize("chat.assign"),
  claimStaffChatConversationController,
);
router.post(
  "/conversations/:conversationId/messages",
  authorize("chat.reply"),
  sendStaffChatMessageController,
);
router.post(
  "/conversations/:conversationId/close",
  authorize("chat.close"),
  closeStaffChatConversationController,
);

export default router;
