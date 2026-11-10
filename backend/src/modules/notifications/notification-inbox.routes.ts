import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import { getInbox, markAllRead, markRead } from "./notification-inbox.controller";

const customerRouter = Router();
customerRouter.use(authenticate, requireCustomer);
customerRouter.get("/", getInbox);
customerRouter.patch("/read-all", markAllRead);
customerRouter.patch("/:notificationId/read", markRead);

export default customerRouter;
