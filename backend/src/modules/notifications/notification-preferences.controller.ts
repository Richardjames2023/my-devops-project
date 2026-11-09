import type { Response } from "express";
import { NotificationCategory } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  listNotificationPreferences,
  updateNotificationPreference,
} from "./notification-preferences.service";

const categoryValues = Object.values(NotificationCategory);
const categorySchema = z.string().refine(
  (value): value is NotificationCategory => categoryValues.includes(value as NotificationCategory),
  "Invalid notification category",
);
const updateSchema = z.object({
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
}).strict().refine(
  (value) => value.inAppEnabled !== undefined || value.emailEnabled !== undefined,
  "At least one notification channel must be provided",
);

function identityFromRequest(req: AuthenticatedRequest) {
  if (!req.user) return null;
  return {
    recipientType: req.user.identityType,
    recipientId: req.user.id,
  } as const;
}

export async function getPreferences(req: AuthenticatedRequest, res: Response): Promise<void> {
  const identity = identityFromRequest(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const preferences = await listNotificationPreferences(identity);
  res.status(200).json({
    message: "Notification preferences retrieved successfully",
    preferences,
  });
}

export async function updatePreference(req: AuthenticatedRequest, res: Response): Promise<void> {
  const identity = identityFromRequest(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const categoryResult = categorySchema.safeParse(req.params.category);
  if (!categoryResult.success) {
    res.status(400).json({ message: "Invalid notification category" });
    return;
  }

  const inputResult = updateSchema.safeParse(req.body);
  if (!inputResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(inputResult.error).fieldErrors,
    });
    return;
  }

  const preference = await updateNotificationPreference(
    identity,
    categoryResult.data,
    {
      ...(inputResult.data.inAppEnabled === undefined
        ? {}
        : { inAppEnabled: inputResult.data.inAppEnabled }),
      ...(inputResult.data.emailEnabled === undefined
        ? {}
        : { emailEnabled: inputResult.data.emailEnabled }),
    },
  );
  res.status(200).json({
    message: "Notification preference updated successfully",
    preference,
  });
}
