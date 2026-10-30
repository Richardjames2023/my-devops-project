
import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import {
  get,
  addItem,
  updateItem,
  removeItem,
  clear,
} from "./cart.controller";

const router = Router();

router.get("/", authenticate, get);
router.post("/items", authenticate, addItem);
router.patch("/items/:itemId", authenticate, updateItem);
router.delete("/items/:itemId", authenticate, removeItem);
router.delete("/", authenticate, clear);

export default router;
