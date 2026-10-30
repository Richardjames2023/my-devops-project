
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/AppError";

export const MAX_EVIDENCE_FILES = 5;
export const MAX_EVIDENCE_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_EVIDENCE_FILES,
    fileSize: MAX_EVIDENCE_FILE_SIZE,
    fields: 0,
    parts: MAX_EVIDENCE_FILES,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(
        new AppError(
          "Only JPEG, PNG, WebP, AVIF, MP4, WebM, and QuickTime files are allowed",
          400,
        ),
      );
      return;
    }

    callback(null, true);
  },
});

export function uploadReturnEvidence(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.array("evidence", MAX_EVIDENCE_FILES)(
    req,
    res,
    (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(new AppError("Each evidence file must be 20 MB or smaller", 413));
          return;
        }

        if (
          error.code === "LIMIT_FILE_COUNT" ||
          error.code === "LIMIT_PART_COUNT"
        ) {
          next(new AppError("A maximum of 5 evidence files is allowed", 400));
          return;
        }

        if (error.code === "LIMIT_UNEXPECTED_FILE") {
          next(new AppError('Use the multipart field name "evidence"', 400));
          return;
        }

        next(new AppError("Invalid evidence upload", 400));
        return;
      }

      next(error);
    },
  );
}
