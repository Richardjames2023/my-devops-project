import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import { add, get, remove } from "./wishlist.controller";

const router = Router();

router.use(authenticate, requireCustomer);
router.get("/", get);
router.post("/", add);
router.delete("/:productId", remove);

export default router;
