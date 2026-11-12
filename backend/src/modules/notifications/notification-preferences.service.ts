import { NotificationCategory, type NotificationRecipientType } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

export interface NotificationPreferenceIdentity {
  recipientType: NotificationRecipientType;
  recipientId: string;
}

export interface NotificationPreferenceInput {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
}

function identityWhere(identity: NotificationPreferenceIdentity) {
  return identity.recipientType === "CUSTOMER"
    ? { recipientType: "CUSTOMER" as const, customerUserId: identity.recipientId, staffAccountId: null }
    : { recipientType: "STAFF" as const, staffAccountId: identity.recipientId, customerUserId: null };
}

/**
 * Payment, security, and refund-intervention notifications are mandatory on
 * both channels. Routine categories are in-app only; recipient preferences
 * cannot opt them into email. Staff invitations use their separate secure flow.
 */
function mandatoryChannels(category: NotificationCategory) {
  if (category === "PAYMENT" || category === "SECURITY" || category === "REFUND") {
    return { inApp: true, email: true };
  }
  return { inApp: false, email: false };
}

export async function listNotificationPreferences(identity: NotificationPreferenceIdentity) {
  const rows = await prisma.notificationPreference.findMany({
    where: identityWhere(identity),
    select: {
      category: true,
      inAppEnabled: true,
      emailEnabled: true,
      updatedAt: true,
    },
  });
  const byCategory = new Map(rows.map((row) => [row.category, row]));

  return Object.values(NotificationCategory).map((category) => {
    const saved = byCategory.get(category);
    const mandatory = mandatoryChannels(category);
    return {
      category,
      inAppEnabled: mandatory.inApp || (saved?.inAppEnabled ?? true),
      emailEnabled: mandatory.email,
      mandatory,
      updatedAt: saved?.updatedAt ?? null,
    };
  });
}

export async function updateNotificationPreference(
  identity: NotificationPreferenceIdentity,
  category: NotificationCategory,
  input: NotificationPreferenceInput,
) {
  if (input.inAppEnabled === undefined && input.emailEnabled === undefined) {
    throw new AppError("At least one notification channel must be provided", 400);
  }

  const mandatory = mandatoryChannels(category);
  if (mandatory.inApp && input.inAppEnabled === false) {
    throw new AppError("In-app notifications for this category cannot be disabled", 400);
  }
  if (mandatory.email && input.emailEnabled === false) {
    throw new AppError("Email notifications for this category cannot be disabled", 400);
  }
  if (!mandatory.email && input.emailEnabled === true) {
    throw new AppError("Email notifications are not available for this category", 400);
  }

  const where = { ...identityWhere(identity), category };
  const data = {
    ...(input.inAppEnabled === undefined ? {} : { inAppEnabled: input.inAppEnabled }),
    ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
  };

  // createMany(skipDuplicates) plus updateMany is safe under concurrent
  // preference writes and respects the database's partial unique indexes.
  await prisma.$transaction(async (tx) => {
    await tx.notificationPreference.createMany({
      data: [{
        ...identityWhere(identity),
        category,
        inAppEnabled: true,
        emailEnabled: false,
      }],
      skipDuplicates: true,
    });
    await tx.notificationPreference.updateMany({ where, data });
  });

  const saved = await prisma.notificationPreference.findFirst({
    where,
    select: {
      category: true,
      inAppEnabled: true,
      emailEnabled: true,
      updatedAt: true,
    },
  });

  if (!saved) throw new AppError("Unable to save notification preferences", 500);

  return {
    ...saved,
    inAppEnabled: mandatory.inApp || saved.inAppEnabled,
    emailEnabled: mandatory.email,
    mandatory,
  };
}
