import type { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { verifyPassword } from "../../common/utils/password";
import { createAuditLog } from "../../common/utils/audit-log";

const DELETION_GRACE_PERIOD_DAYS = 30;
const DELETION_DEFERRAL_DAYS = 7;
const DELETION_BATCH_SIZE = 25;

export interface UpdateCustomerProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

export async function updateCustomerProfile(userId: string, input: UpdateCustomerProfileInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, phone: true, isActive: true },
      });
      if (!user || !user.isActive) throw new AppError("Customer account is unavailable", 403);

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
        },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, emailVerified: true, createdAt: true, updatedAt: true },
      });

      await createAuditLog(tx, {
        userId,
        action: "CUSTOMER_PROFILE_UPDATED",
        entity: "CUSTOMER",
        entityId: userId,
        oldValues: { firstName: user.firstName, lastName: user.lastName, phone: user.phone },
        newValues: { firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone },
      });
      return updated;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new AppError("That phone number is already associated with another account", 409);
    }
    throw error;
  }
}

export async function requestCustomerAccountDeletion(userId: string, password: string) {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (!current || !current.isActive) throw new AppError("Customer account is unavailable", 403);
  if (!(await verifyPassword(password, current.passwordHash))) {
    throw new AppError("Password confirmation failed", 401);
  }

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, passwordHash: true },
    });
    if (!user) throw new AppError("Customer account is unavailable", 403);
    if (user.passwordHash !== current.passwordHash) {
      throw new AppError("Password changed during this request. Please try again.", 409);
    }

    const existing = await tx.customerAccountDeletion.findUnique({ where: { userId } });
    if (!user.isActive && existing?.status === "REQUESTED") {
      return { status: existing.status, requestedAt: existing.requestedAt, scheduledFor: existing.scheduledFor, gracePeriodDays: DELETION_GRACE_PERIOD_DAYS };
    }
    if (!user.isActive) throw new AppError("Customer account is unavailable", 403);
    if (existing?.status === "REQUESTED") {
      return { status: existing.status, requestedAt: existing.requestedAt, scheduledFor: existing.scheduledFor, gracePeriodDays: DELETION_GRACE_PERIOD_DAYS };
    }
    if (existing?.status === "COMPLETED") {
      throw new AppError("This customer account has already been anonymized", 410);
    }

    await tx.customerAccountDeletion.upsert({
      where: { userId },
      create: { userId, status: "REQUESTED", requestedAt: now, scheduledFor },
      update: { status: "REQUESTED", requestedAt: now, scheduledFor, cancelledAt: null, completedAt: null, lastDeferredAt: null, deferralCount: 0 },
    });

    await tx.user.update({
      where: { id: userId },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.customerEmailVerificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.customerPasswordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await createAuditLog(tx, {
      userId,
      action: "CUSTOMER_ACCOUNT_DELETION_REQUESTED",
      entity: "CUSTOMER",
      entityId: userId,
      newValues: { status: "REQUESTED", scheduledFor: scheduledFor.toISOString(), gracePeriodDays: DELETION_GRACE_PERIOD_DAYS },
    });

    return { status: "REQUESTED" as const, requestedAt: now, scheduledFor, gracePeriodDays: DELETION_GRACE_PERIOD_DAYS };
  });
}

export async function cancelCustomerAccountDeletion(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (!user || user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("Unable to cancel this account deletion request", 400);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}::text, 0))`;
    const deletion = await tx.customerAccountDeletion.findUnique({ where: { userId: user.id } });
    const now = new Date();
    if (!deletion || deletion.status !== "REQUESTED" || deletion.scheduledFor <= now) {
      throw new AppError("The account deletion cancellation period has ended or no request is active", 410);
    }

    const changed = await tx.customerAccountDeletion.updateMany({
      where: { id: deletion.id, status: "REQUESTED", scheduledFor: { gt: now } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (changed.count !== 1) throw new AppError("Unable to cancel this account deletion request", 409);

    await tx.user.update({
      where: { id: user.id },
      data: { isActive: true, sessionVersion: { increment: 1 } },
    });
    await createAuditLog(tx, {
      userId: user.id,
      action: "CUSTOMER_ACCOUNT_DELETION_CANCELLED",
      entity: "CUSTOMER",
      entityId: user.id,
      newValues: { status: "CANCELLED", cancelledAt: now.toISOString() },
    });
    return { status: "CANCELLED" as const, message: "Account restored. Please log in again." };
  });
}

async function hasOutstandingCustomerActivity(tx: Prisma.TransactionClient, userId: string) {
  const [openOrders, openPayments, openRefunds, openReturns, openWarranties, openDeliveries, activeReservations] = await Promise.all([
    tx.order.findFirst({ where: { userId, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "PARTIALLY_FULFILLED"] } }, select: { id: true } }),
    tx.payment.findFirst({ where: { order: { userId }, status: { in: ["PENDING", "INITIALIZATION_UNKNOWN", "PROCESSING"] } }, select: { id: true } }),
    tx.refund.findFirst({ where: { order: { userId }, status: { in: ["PENDING", "PROCESSING", "NEEDS_ATTENTION", "SUBMISSION_UNKNOWN"] } }, select: { id: true } }),
    tx.returnRequest.findFirst({ where: { userId, status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "RECEIVED", "INSPECTED"] } }, select: { id: true } }),
    tx.warrantyClaim.findFirst({ where: { userId, status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED"] } }, select: { id: true } }),
    tx.delivery.findFirst({ where: { package: { fulfillment: { order: { userId } } }, status: { in: ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED"] } }, select: { id: true } }),
    tx.inventoryReservation.findFirst({ where: { order: { userId }, status: "PENDING" }, select: { id: true } }),
  ]);
  return Boolean(openOrders || openPayments || openRefunds || openReturns || openWarranties || openDeliveries || activeReservations);
}

async function anonymizeCustomer(tx: Prisma.TransactionClient, user: { id: string; email: string }) {
  const now = new Date();
  const notifications = await tx.notification.findMany({ where: { customerUserId: user.id }, select: { id: true } });
  const notificationIds = notifications.map((item) => item.id);

  if (notificationIds.length) {
    await tx.notificationEmailDelivery.deleteMany({ where: { notificationId: { in: notificationIds } } });
  }
  await tx.notificationEmailDelivery.deleteMany({ where: { recipientEmail: user.email } });
  await tx.notification.deleteMany({ where: { customerUserId: user.id } });
  await tx.notificationPreference.deleteMany({ where: { customerUserId: user.id } });
  await tx.wishlistItem.deleteMany({ where: { userId: user.id } });
  await tx.cart.deleteMany({ where: { userId: user.id } });
  await tx.refreshToken.deleteMany({ where: { userId: user.id } });
  await tx.customerEmailVerificationToken.deleteMany({ where: { userId: user.id } });
  await tx.customerPasswordResetToken.deleteMany({ where: { userId: user.id } });
  await tx.userRole.deleteMany({ where: { userId: user.id } });

  await tx.auditLog.updateMany({
    where: { userId: user.id },
    data: { userId: null, ipAddress: null, userAgent: null, oldValues: null, newValues: null },
  });
  await tx.order.updateMany({
    where: { userId: user.id },
    data: {
      customerName: null,
      customerEmail: null,
      customerPhone: null,
      shippingAddress: { anonymized: true },
    },
  });
  await tx.user.update({
    where: { id: user.id },
    data: {
      email: `deleted+${user.id}@deleted.invalid`,
      firstName: "Deleted",
      lastName: "Customer",
      phone: null,
      isActive: false,
      sessionVersion: { increment: 1 },
    },
  });
  await tx.customerAccountDeletion.update({
    where: { userId: user.id },
    data: { status: "COMPLETED", completedAt: now },
  });
  await createAuditLog(tx, {
    action: "CUSTOMER_ACCOUNT_ANONYMIZED",
    entity: "CUSTOMER",
    entityId: user.id,
    newValues: { status: "COMPLETED", completedAt: now.toISOString(), retainedFinancialAndAfterSalesRecords: true },
  });
}

export async function processCustomerAccountDeletionBatch() {
  const due = await prisma.customerAccountDeletion.findMany({
    where: { status: "REQUESTED", scheduledFor: { lte: new Date() } },
    select: { id: true, userId: true },
    orderBy: { scheduledFor: "asc" },
    take: DELETION_BATCH_SIZE,
  });

  let completed = 0;
  let deferred = 0;
  let failed = 0;
  for (const candidate of due) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.userId}::text, 0))`;
        const deletion = await tx.customerAccountDeletion.findUnique({ where: { id: candidate.id } });
        if (!deletion || deletion.status !== "REQUESTED" || deletion.scheduledFor > new Date()) return "SKIPPED";

        const user = await tx.user.findUnique({ where: { id: candidate.userId }, select: { id: true, email: true } });
        if (!user) {
          await tx.customerAccountDeletion.update({ where: { id: candidate.id }, data: { status: "COMPLETED", completedAt: new Date() } });
          return "COMPLETED";
        }

        if (await hasOutstandingCustomerActivity(tx, user.id)) {
          const now = new Date();
          await tx.customerAccountDeletion.updateMany({
            where: { id: candidate.id, status: "REQUESTED", scheduledFor: { lte: now } },
            data: { scheduledFor: new Date(now.getTime() + DELETION_DEFERRAL_DAYS * 24 * 60 * 60 * 1000), lastDeferredAt: now, deferralCount: { increment: 1 } },
          });
          return "DEFERRED";
        }

        await anonymizeCustomer(tx, user);
        return "COMPLETED";
      });
      if (outcome === "COMPLETED") completed += 1;
      if (outcome === "DEFERRED") deferred += 1;
    } catch (error) {
      failed += 1;
      console.error("[CUSTOMER DELETION] Failed to process request", candidate.id, error);
    }
  }
  return { claimed: due.length, completed, deferred, failed };
}
