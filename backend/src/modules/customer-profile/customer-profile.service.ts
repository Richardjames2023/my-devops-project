import { Prisma } from "@prisma/client";
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
    const cancellationDeadline = deletion
      ? new Date(deletion.requestedAt.getTime() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
      : now;
    if (!deletion || deletion.status !== "REQUESTED" || cancellationDeadline <= now) {
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

async function getCustomerDeletionDeferral(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ required: boolean; scheduledFor: Date }> {
  const now = new Date();
  const defaultDeferral = new Date(now.getTime() + DELETION_DEFERRAL_DAYS * 24 * 60 * 60 * 1000);
  const [
    openOrders,
    openPayments,
    openRefunds,
    openReturns,
    openWarranties,
    openDeliveries,
    activeReservations,
    unresolvedReconciliations,
    activeWarranties,
    warrantiesMissingExpiry,
  ] = await Promise.all([
    tx.order.findFirst({ where: { userId, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "PARTIALLY_FULFILLED"] } }, select: { id: true } }),
    tx.payment.findFirst({ where: { order: { userId }, status: { in: ["PENDING", "INITIALIZATION_UNKNOWN", "PROCESSING"] } }, select: { id: true } }),
    tx.refund.findFirst({ where: { order: { userId }, status: { in: ["PENDING", "PROCESSING", "NEEDS_ATTENTION", "SUBMISSION_UNKNOWN"] } }, select: { id: true } }),
    tx.returnRequest.findFirst({ where: { userId, status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "RECEIVED", "INSPECTED"] } }, select: { id: true } }),
    tx.warrantyClaim.findFirst({ where: { userId, status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED"] } }, select: { id: true } }),
    tx.delivery.findFirst({ where: { package: { fulfillment: { order: { userId } } }, status: { in: ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED"] } }, select: { id: true } }),
    tx.inventoryReservation.findFirst({ where: { order: { userId }, status: "PENDING" }, select: { id: true } }),
    tx.paymentInventoryReconciliation.findFirst({
      where: { order: { userId }, status: { in: ["PENDING", "UNDER_REVIEW", "REFUND_PENDING"] } },
      select: { id: true },
    }),
    tx.orderItem.aggregate({
      where: { order: { userId }, hasWarranty: true, warrantyExpiresAt: { gt: now } },
      _max: { warrantyExpiresAt: true },
    }),
    tx.orderItem.findFirst({
      where: {
        order: { userId },
        hasWarranty: true,
        warrantyStartedAt: { not: null },
        warrantyExpiresAt: null,
      },
      select: { id: true },
    }),
  ]);

  const hasOperationalActivity = Boolean(
    openOrders || openPayments || openRefunds || openReturns ||
    openWarranties || openDeliveries || activeReservations || unresolvedReconciliations,
  );
  const latestActiveWarrantyExpiry = activeWarranties._max.warrantyExpiresAt;
  const hasActiveWarranty = Boolean(latestActiveWarrantyExpiry || warrantiesMissingExpiry);
  if (!hasOperationalActivity && !hasActiveWarranty) {
    return { required: false, scheduledFor: defaultDeferral };
  }

  // Recheck at the earlier of the normal retry interval or the last known
  // warranty expiry, so the worker does not repeatedly postpone an expired entitlement.
  const warrantyCheckAt = latestActiveWarrantyExpiry
    ? new Date(latestActiveWarrantyExpiry.getTime() + 60_000)
    : defaultDeferral;
  const scheduledFor = hasActiveWarranty && warrantyCheckAt < defaultDeferral
    ? warrantyCheckAt
    : defaultDeferral;

  return { required: true, scheduledFor };
}

async function anonymizeCustomer(tx: Prisma.TransactionClient, user: { id: string; email: string }) {
  const now = new Date();
  const notifications = await tx.notification.findMany({ where: { customerUserId: user.id }, select: { id: true } });
  const notificationIds = notifications.map((item) => item.id);
  const emailDeliveries = await tx.notificationEmailDelivery.findMany({
    where: {
      OR: [
        { recipientEmail: user.email },
        ...(notificationIds.length ? [{ notificationId: { in: notificationIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const emailDeliveryIds = emailDeliveries.map((delivery) => delivery.id);

  if (emailDeliveryIds.length) {
    // Provider webhook payloads may contain recipient addresses and other PII.
    // Preserve the event/delivery audit metadata, but remove the raw provider body.
    await tx.notificationEmailEvent.updateMany({
      where: { deliveryId: { in: emailDeliveryIds } },
      data: { payload: { anonymized: true } },
    });
    await tx.notificationEmailDelivery.deleteMany({
      where: { id: { in: emailDeliveryIds } },
    });
  }
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
    data: {
      userId: null,
      ipAddress: null,
      userAgent: null,
      oldValues: Prisma.DbNull,
      newValues: Prisma.DbNull,
    },
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
  // Prisma DateTime fields are stored as TIMESTAMP(3) WITHOUT TIME ZONE.
  // Compare them against an explicit UTC database clock to avoid runtime/session
  // timezone differences between Node.js and PostgreSQL.
  const due = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT "id", "userId"
    FROM "customer_account_deletions"
    WHERE "status" = 'REQUESTED'
      AND "scheduledFor" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ORDER BY "scheduledFor" ASC
    LIMIT ${DELETION_BATCH_SIZE}
  `;

  let completed = 0;
  let deferred = 0;
  let failed = 0;
  for (const candidate of due) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.userId}::text, 0))`;
        const [deletion] = await tx.$queryRaw<Array<{ status: string; isDue: boolean }>>`
          SELECT "status",
            ("scheduledFor" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS "isDue"
          FROM "customer_account_deletions"
          WHERE "id" = ${candidate.id}::uuid
          FOR UPDATE
        `;
        if (!deletion || deletion.status !== "REQUESTED" || !deletion.isDue) return "SKIPPED";

        const user = await tx.user.findUnique({ where: { id: candidate.userId }, select: { id: true, email: true } });
        if (!user) {
          await tx.customerAccountDeletion.update({ where: { id: candidate.id }, data: { status: "COMPLETED", completedAt: new Date() } });
          return "COMPLETED";
        }

        const deferral = await getCustomerDeletionDeferral(tx, user.id);
        if (deferral.required) {
          await tx.$executeRaw`
            UPDATE "customer_account_deletions"
            SET "scheduledFor" = ${deferral.scheduledFor},
                "lastDeferredAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
                "deferralCount" = "deferralCount" + 1
            WHERE "id" = ${candidate.id}::uuid
              AND "status" = 'REQUESTED'
          `;
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