import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  inventoryReport,
  overview,
  productPerformanceReport,
  salesReport,
} from "./analytics.controller";

const router = Router();

router.use(authenticate);
router.get("/overview", authorize("reports.read"), overview);
router.get("/sales", authorize("reports.read"), salesReport);
router.get("/products", authorize("reports.read"), productPerformanceReport);
router.get("/inventory", authorize("reports.read"), inventoryReport);

export default router;
