import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger";

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  let completed = false;

  const context = (aborted: boolean) => ({
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    ...(aborted ? { aborted: true } : {}),
    ...(typeof res.locals.requestId === "string" ? { requestId: res.locals.requestId } : {}),
  });

  res.once("finish", () => {
    completed = true;
    const details = context(false);
    if (res.statusCode >= 500) logger.error("HTTP request failed", undefined, details);
    else if (res.statusCode >= 400) logger.warn("HTTP request completed with client error", details);
    else logger.info("HTTP request completed", details);
  });

  res.once("close", () => {
    if (completed || res.writableFinished) return;
    logger.warn("HTTP request connection closed before response completed", context(true));
  });

  next();
}
