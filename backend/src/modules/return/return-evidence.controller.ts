
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { createReturnEvidence } from "./return-evidence.service";

export async function uploadEvidence(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  const returnRequestId = req.params.returnRequestId;

  if (
    typeof returnRequestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      returnRequestId,
    )
  ) {
    throw new AppError("Invalid return request ID", 400);
  }

  const files = req.files;

  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError("Upload at least one evidence file", 400);
  }

  const evidence = await createReturnEvidence(
    returnRequestId,
    req.user.id,
    req.user.permissions,
    files,
  );

  res.status(201).json({
    message: "Return evidence uploaded successfully",
    evidence,
  });
}
