import { Router } from "express";
import { requireGuestSession } from "../guest-session/guest-session.middleware";
import {
  getGuestCartController,
  addGuestCartItemController,
  updateGuestCartItemController,
  removeGuestCartItemController,
  clearGuestCartController,
} from "./guest-cart.controller";

const router = Router();

router.get("/", requireGuestSession, getGuestCartController);

router.post("/items", requireGuestSession, addGuestCartItemController);

router.patch(
  "/items/:itemId",
  requireGuestSession,
  updateGuestCartItemController,
);

router.delete(
  "/items/:itemId",
  requireGuestSession,
  removeGuestCartItemController,
);

router.delete("/", requireGuestSession, clearGuestCartController);

export default router;
