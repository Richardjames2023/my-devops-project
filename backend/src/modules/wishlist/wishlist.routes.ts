import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import {
  wishlistMutationLimiter,
  wishlistReadLimiter,
} from "../../common/middleware/rate-limit.middleware";
import { add, get, moveToCart, remove } from "./wishlist.controller";

const router = Router();

router.use(authenticate, requireCustomer);
router.get("/", wishlistReadLimiter, get);
router.post("/", wishlistMutationLimiter, add);
router.post("/:productId/move-to-cart", wishlistMutationLimiter, moveToCart);
router.delete("/:productId", wishlistMutationLimiter, remove);

export default router;
