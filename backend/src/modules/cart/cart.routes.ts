
import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { requireCustomer } from "../../common/middleware/authorize";
import {
  get,
  addItem,
  updateItem,
  removeItem,
  clear,
} from "./cart.controller";

const router = Router();

router.get("/", authenticate, requireCustomer, get);
router.post("/items", authenticate, requireCustomer, addItem);
router.patch("/items/:itemId", authenticate, requireCustomer, updateItem);
router.delete("/items/:itemId", authenticate, requireCustomer, removeItem);
router.delete("/", authenticate, requireCustomer, clear);

export default router;
