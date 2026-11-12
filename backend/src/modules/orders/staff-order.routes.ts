import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { get, list } from "./staff-order.controller";

const router = Router();

router.use(authenticate);
router.get("/", authorize("orders.read"), list);
router.get("/:orderId", authorize("orders.read"), get);

export default router;
