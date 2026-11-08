import type { NotificationRecipientType, Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

export interface NotificationIdentity {
  recipientType: NotificationRecipientType;
  recipientId: string;
}

export interface NotificationPageInput {
  page: number;
  pageSize: number;
}

function recipientWhere(identity: NotificationIdentity): Prisma.NotificationWhereInput {
  return identity.recipientType === "CUSTOMER"
    ? { recipientType: "CUSTOMER", customerUserId: identity.recipientId, staffAccountId: null }
    : { recipientType: "STAFF", staffAccountId: identity.recipientId, customerUserId: null };
}

const notificationSelect = {
  id: true,
  category: true,
  title: true,
  body: true,
  actionUrl: true,
  metadata: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export async function listNotifications(
  identity: NotificationIdentity,
  pagination: NotificationPageInput,
) {
  const where = recipientWhere(identity);
  const skip = (pagination.page - 1) * pagination.pageSize;

  const [notifications, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pagination.pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return {
    notifications,
    unreadCount,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

export async function markNotificationRead(
  identity: NotificationIdentity,
  notificationId: string,
) {
  const where = { id: notificationId, ...recipientWhere(identity) };
  await prisma.notification.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() },
  });

  const notification = await prisma.notification.findFirst({
    where,
    select: notificationSelect,
  });

  if (!notification) {
    throw new AppError("Notification not found", 404);
  }

  return notification;
}

export async function markAllNotificationsRead(identity: NotificationIdentity) {
  const result = await prisma.notification.updateMany({
    where: { ...recipientWhere(identity), readAt: null },
    data: { readAt: new Date() },
  });

  return { updatedCount: result.count };
}
