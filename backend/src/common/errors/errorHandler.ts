import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";
import { logger } from "../../config/logger";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    if (!error.isOperational) logger.error("Non-operational application error", error, { statusCode: error.statusCode });
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ message: "A resource with this value already exists" });
    return;
  }

  logger.error("Unhandled request error", error);
  res.status(500).json({ message: "Internal server error" });
};
