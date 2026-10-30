import { Router } from "express";
import {
  register,
  login,
  refresh,
} from "./auth.controller";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);

router.get(
  "/me",
  authenticate,
);

export default router;