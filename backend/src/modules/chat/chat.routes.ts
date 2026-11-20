import { Router } from "express";
import {
  chatConversationLimiter,
  chatHandoffLimiter,
  chatMessageLimiter,
  chatReadLimiter,
} from "../../common/middleware/rate-limit.middleware";
import { resolveChatOwner } from "./chat.middleware";
import {
  createConversationController,
  getConversationController,
  listConversationMessagesController,
  listConversationRealtimeEventsController,
  listConversationsController,
  requestHumanHandoffController,
  sendCustomerMessageController,
} from "./chat.controller";

const router = Router();

router.use(resolveChatOwner);

router.post("/conversations", chatConversationLimiter, createConversationController);
router.get("/conversations", chatReadLimiter, listConversationsController);
router.get("/conversations/:conversationId", chatReadLimiter, getConversationController);
router.get(
  "/conversations/:conversationId/events",
  chatReadLimiter,
  listConversationRealtimeEventsController,
);
router.get(
  "/conversations/:conversationId/messages",
  chatReadLimiter,
  listConversationMessagesController,
);
router.post(
  "/conversations/:conversationId/messages",
  chatMessageLimiter,
  sendCustomerMessageController,
);
router.post(
  "/conversations/:conversationId/handoff",
  chatHandoffLimiter,
  requestHumanHandoffController,
);

export default router;
