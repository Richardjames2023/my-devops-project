import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger";

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  res.on("finish", () => {
    const context = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      ...(typeof res.locals.requestId === "string" ? { requestId: res.locals.requestId } : {}),
    };
    if (res.statusCode >= 500) logger.error("HTTP request failed", undefined, context);
    else if (res.statusCode >= 400) logger.warn("HTTP request completed with client error", context);
    else logger.info("HTTP request completed", context);
  });
  next();
}
