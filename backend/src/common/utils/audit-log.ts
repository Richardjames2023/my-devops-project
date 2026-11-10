
import type { Prisma } from "@prisma/client";

interface CreateAuditLogInput {
  userId?: string;
  staffAccountId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(
  tx: Prisma.TransactionClient,
  input: CreateAuditLogInput,
) {
  return tx.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,

      ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
      ...(input.staffAccountId
        ? { staffAccount: { connect: { id: input.staffAccountId } } }
        : {}),

      ...(input.entityId !== undefined
        ? { entityId: input.entityId }
        : {}),

      ...(input.oldValues !== undefined
        ? { oldValues: input.oldValues }
        : {}),

      ...(input.newValues !== undefined
        ? { newValues: input.newValues }
        : {}),

      ...(input.ipAddress !== undefined
        ? { ipAddress: input.ipAddress }
        : {}),

      ...(input.userAgent !== undefined
        ? { userAgent: input.userAgent }
        : {}),
    },
  });
}
