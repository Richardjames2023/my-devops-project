import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { analyticsQuerySchema } from "./analytics.validation";
import { getAnalyticsOverview } from "./analytics.service";

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
