import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "../../config/logger";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const suppliedId = req.header("x-request-id")?.trim();
  const id = suppliedId && REQUEST_ID_PATTERN.test(suppliedId)
    ? suppliedId
    : randomUUID();

  res.setHeader("x-request-id", id);
  res.locals.requestId = id;
  runWithRequestContext(id, next);
}
