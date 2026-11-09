import { Router } from "express";
import { listActive, quote } from "./delivery-zone.controller";

const router = Router();

// Public checkout endpoints; authentication is optional.
router.get("/", listActive);
router.get("/quote", quote);

export default router;
