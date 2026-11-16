import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { analyticsQuerySchema } from "./analytics.validation";
import { getAnalyticsOverview } from "./analytics.service";
import {
  getInventoryReport,
  getProductPerformanceReport,
  getSalesReport,
} from "./analytics.reports.service";

type ReportHandler = (query: z.infer<typeof analyticsQuerySchema>) => Promise<unknown>;

async function respondWithReport(
  req: AuthenticatedRequest,
  res: Response,
  handler: ReportHandler,
  message: string,
  key: string,
): Promise<void> {
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const report = await handler(parsed.data);
  res.status(200).json({ message, [key]: report });
}

export async function overview(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  const analytics = await getAnalyticsOverview(parsed.data);
  res.status(200).json({
    message: "Analytics overview retrieved successfully",
    analytics,
  });
}

export const salesReport = (req: AuthenticatedRequest, res: Response) =>
  respondWithReport(req, res, getSalesReport, "Sales report retrieved successfully", "report");

export const productPerformanceReport = (req: AuthenticatedRequest, res: Response) =>
  respondWithReport(req, res, getProductPerformanceReport, "Product performance report retrieved successfully", "report");

export const inventoryReport = (req: AuthenticatedRequest, res: Response) =>
  respondWithReport(req, res, getInventoryReport, "Inventory report retrieved successfully", "report");
