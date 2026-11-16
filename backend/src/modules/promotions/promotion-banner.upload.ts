import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";

const MAX_SIZE = 8 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 2, fileSize: MAX_SIZE, fields: 12, parts: 14 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype)) {
      callback(new AppError("Only JPEG, PNG, WebP, and AVIF images are allowed", 400));
      return;
    }
    callback(null, true);
  },
});

export function uploadPromotionBanner(req: Request, res: Response, next: NextFunction): void {
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "mobileImage", maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new AppError(error.code === "LIMIT_FILE_SIZE" ? "Banner image must be 8 MB or smaller" : "Invalid banner image upload", error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE" ? 400 : 413));
      return;
    }
    next(error);
  });
}
