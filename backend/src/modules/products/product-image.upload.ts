import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";

export const MAX_PRODUCT_IMAGES = 10;
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_PRODUCT_IMAGES,
    fileSize: MAX_PRODUCT_IMAGE_SIZE,
    fields: 0,
    parts: MAX_PRODUCT_IMAGES,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(
        new AppError("Only JPEG, PNG, WebP, and AVIF images are allowed", 400),
      );
      return;
    }

    callback(null, true);
  },
});

export function uploadProductImages(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.array("images", MAX_PRODUCT_IMAGES)(
    req,
    res,
    (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(new AppError("Each product image must be 5 MB or smaller", 413));
          return;
        }

        if (
          error.code === "LIMIT_FILE_COUNT" ||
          error.code === "LIMIT_PART_COUNT"
        ) {
          next(new AppError("A maximum of 10 product images can be uploaded at once", 400));
          return;
        }

        if (error.code === "LIMIT_UNEXPECTED_FILE") {
          next(new AppError('Use the multipart field name "images"', 400));
          return;
        }

        next(new AppError("Invalid product image upload", 400));
        return;
      }

      next(error);
    },
  );
}
