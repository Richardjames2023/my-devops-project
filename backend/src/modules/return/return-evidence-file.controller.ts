
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { getReturnEvidenceFileSource } from "./return-evidence-view.service";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function streamEvidenceFile(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const evidenceId = req.params.evidenceId;

  if (
    typeof evidenceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      evidenceId,
    )
  ) {
    res.status(400).json({ message: "Invalid evidence ID" });
    return;
  }

  const source = await getReturnEvidenceFileSource(
    evidenceId,
    req.user.id,
    req.user.permissions,
  );

  const upstream = await fetch(source.signedUrl, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });

  if (!upstream.ok || !upstream.body) {
    throw new AppError("Unable to retrieve evidence file", 502);
  }

  const contentLength = upstream.headers.get("content-length");

  if (contentLength !== null) {
    const declaredSize = Number(contentLength);

    if (
      !Number.isSafeInteger(declaredSize) ||
      declaredSize < 0 ||
      declaredSize > MAX_FILE_SIZE
    ) {
      await upstream.body.cancel().catch(() => {});
      throw new AppError(
        "Evidence file exceeds the allowed size",
        413,
      );
    }
  }

  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalSize += value.byteLength;

      if (totalSize > MAX_FILE_SIZE) {
        await reader.cancel().catch(() => {});
        throw new AppError(
          "Evidence file exceeds the allowed size",
          413,
        );
      }

      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Unable to retrieve evidence file", 502);
  }

  const fileBuffer = Buffer.concat(chunks, totalSize);

  res.status(200);
  res.setHeader("Content-Type", source.type);
  res.setHeader("Content-Length", fileBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");

  res.end(fileBuffer);
}
