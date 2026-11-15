import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { overview } from "./analytics.controller";

const router = Router();

router.use(authenticate);
router.get("/overview", authorize("reports.read"), overview);

export default router;
