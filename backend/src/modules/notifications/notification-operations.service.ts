import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";

export async function listDeadNotificationOutbox(page: number, pageSize: number) {
  const where = { status: "DEAD" as const };
  const [events, total] = await prisma.$transaction([
    prisma.notificationOutbox.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        eventKey: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        attemptCount: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.notificationOutbox.count({ where }),
  ]);
  return {
    events,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function listDeadEmailDeliveries(page: number, pageSize: number) {
  const where = { status: "DEAD" as const };
  const [deliveries, total] = await prisma.$transaction([
    prisma.notificationEmailDelivery.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        recipientEmail: true,
        templateKey: true,
        attemptCount: true,
        lastError: true,
        providerMessageId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.notificationEmailDelivery.count({ where }),
  ]);
  return {
    deliveries,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function retryDeadNotificationOutbox(id: string) {
  const updated = await prisma.notificationOutbox.updateMany({
    where: { id, status: "DEAD" },
    data: {
      status: "PENDING",
      attemptCount: 0,
      availableAt: new Date(),
      processedAt: null,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
  if (updated.count === 1) return { id, status: "PENDING" as const };

  const existing = await prisma.notificationOutbox.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("Notification outbox event not found", 404);
  throw new AppError("Only dead notification events can be retried", 409);
}

export async function retryDeadEmailDelivery(id: string) {
  const updated = await prisma.notificationEmailDelivery.updateMany({
    where: { id, status: "DEAD" },
    data: {
      status: "QUEUED",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
  if (updated.count === 1) return { id, status: "QUEUED" as const };

  const existing = await prisma.notificationEmailDelivery.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("Notification email delivery not found", 404);
  throw new AppError("Only dead email deliveries can be retried", 409);
}
