import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate";
import { authorize } from "../../common/middleware/authorize";
import {
  create,
  list,
  remove,
  update,
} from "./product-image.controller";
import { uploadProductImages } from "./product-image.upload";

const router = Router();

router.get(
  "/:productId/images",
  authenticate,
  authorize("products.manage"),
  list,
);

router.post(
  "/:productId/images",
  authenticate,
  authorize("products.manage"),
  uploadProductImages,
  create,
);

router.patch(
  "/:productId/images/:imageId",
  authenticate,
  authorize("products.manage"),
  update,
);

router.delete(
  "/:productId/images/:imageId",
  authenticate,
  authorize("products.manage"),
  remove,
);

export default router;
