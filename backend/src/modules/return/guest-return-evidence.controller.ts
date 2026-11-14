import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { isValidGuestOrderAccessToken } from "../orders/guest-order-access";
import { createGuestReturnEvidence } from "./return-evidence.service";
import {
  getGuestReturnEvidenceFileSource,
  getGuestReturnEvidenceViewUrl,
} from "./return-evidence-view.service";
import { streamEvidenceSource } from "./return-evidence-file.controller";

const guestEvidenceParamsSchema = z.object({
  orderId: z.uuid("Invalid order ID"),
  evidenceId: z.uuid("Invalid evidence ID").optional(),
  returnRequestId: z.uuid("Invalid return request ID").optional(),
});

function readGuestEvidenceCredentials(
  req: Request,
  res: Response,
): { orderId: string; token: string } | null {
  const params = z.object({ orderId: z.uuid() }).safeParse(req.params);
  const token = req.get("x-guest-order-token");

  if (!params.success || !isValidGuestOrderAccessToken(token)) {
    res.status(404).json({ message: "Return evidence not found" });
    return null;
  }

  return { orderId: params.data.orderId, token };
}

function readEvidenceId(req: Request, res: Response): string | null {
  const parsed = guestEvidenceParamsSchema.safeParse(req.params);

  if (!parsed.success || !parsed.data.evidenceId) {
    res.status(404).json({ message: "Return evidence not found" });
    return null;
  }

  return parsed.data.evidenceId;
}

export async function uploadGuestEvidence(
  req: Request,
  res: Response,
): Promise<void> {
  const credentials = readGuestEvidenceCredentials(req, res);
  if (!credentials) return;

  const params = z.object({
    orderId: z.uuid(),
    returnRequestId: z.uuid(),
  }).safeParse(req.params);

  if (!params.success) {
    res.status(404).json({ message: "Return request not found" });
    return;
  }

  const files = req.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError("Upload at least one evidence file", 400);
  }

  const evidence = await createGuestReturnEvidence(
    params.data.returnRequestId,
    credentials.orderId,
    credentials.token,
    files,
  );

  res.status(201).json({
    message: "Return evidence uploaded successfully",
    evidence,
  });
}

export async function viewGuestEvidence(
  req: Request,
  res: Response,
): Promise<void> {
  const credentials = readGuestEvidenceCredentials(req, res);
  if (!credentials) return;

  const evidenceId = readEvidenceId(req, res);
  if (!evidenceId) return;

  const evidence = await getGuestReturnEvidenceViewUrl(
    evidenceId,
    credentials.orderId,
    credentials.token,
  );

  res.status(200).json({
    message: "Evidence viewing URL generated successfully",
    evidence,
  });
}

export async function streamGuestEvidenceFile(
  req: Request,
  res: Response,
): Promise<void> {
  const credentials = readGuestEvidenceCredentials(req, res);
  if (!credentials) return;

  const evidenceId = readEvidenceId(req, res);
  if (!evidenceId) return;

  const source = await getGuestReturnEvidenceFileSource(
    evidenceId,
    credentials.orderId,
    credentials.token,
  );

  await streamEvidenceSource(source, res);
}
