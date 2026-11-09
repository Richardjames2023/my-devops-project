import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import { create, listAll, update } from "./delivery-zone.controller";

const router = Router();

router.use(authenticate, authorize("delivery_zones.manage"));
router.get("/", listAll);
router.post("/", create);
router.patch("/:zoneId", update);

export default router;
