import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../prisma/client";
import { getCloudinary } from "../../config/cloudinary";
import { logger } from "../../config/logger";

type CloudinaryResourceType = "image" | "video" | "raw";
type CloudinaryDeliveryType = "upload" | "authenticated";

interface CloudinaryCleanupOptions {
  resourceType?: CloudinaryResourceType;
  deliveryType?: CloudinaryDeliveryType;
}

export async function enqueueCloudinaryCleanup(
  publicId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
  options: CloudinaryCleanupOptions = {},
): Promise<void> {
  const resourceType = options.resourceType ?? "image";
  const deliveryType = options.deliveryType ?? "upload";
  await tx.cloudinaryCleanupTask.upsert({
    where: { publicId },
    create: { publicId, resourceType, deliveryType },
    update: {
      resourceType,
      deliveryType,
      status: "PENDING",
      availableAt: new Date(),
      lockedAt: null,
      lockToken: null,
    },
  });
}

export async function deleteCloudinaryAsset(
  publicId: string,
  resourceType: CloudinaryResourceType = "image",
  deliveryType: CloudinaryDeliveryType = "upload",
): Promise<void> {
  const result = await getCloudinary().uploader.destroy(publicId, {
    resource_type: resourceType,
    type: deliveryType,
    invalidate: true,
  });
  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error("Cloudinary deletion was not confirmed");
  }
}

export async function processCloudinaryCleanupBatch(limit = 20): Promise<number> {
  let processed = 0;
  for (let index = 0; index < limit; index++) {
    const token = randomUUID();
    const claimed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        publicId: string;
        resourceType: CloudinaryResourceType;
        deliveryType: CloudinaryDeliveryType;
      }>>(Prisma.sql`
        SELECT id, "publicId", "resourceType", "deliveryType" FROM cloudinary_cleanup_tasks
        WHERE (status = 'PENDING' AND "availableAt" <= NOW())
           OR (status = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '5 minutes')
        ORDER BY "availableAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const row = rows[0];
      if (!row) return null;
      await tx.cloudinaryCleanupTask.update({
        where: { id: row.id },
        data: { status: "PROCESSING", lockedAt: new Date(), lockToken: token },
      });
      return row;
    });
    if (!claimed) break;
    try {
      await deleteCloudinaryAsset(claimed.publicId, claimed.resourceType, claimed.deliveryType);
      await prisma.cloudinaryCleanupTask.deleteMany({
        where: { id: claimed.id, lockToken: token, status: "PROCESSING" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Cloudinary error";
      const task = await prisma.cloudinaryCleanupTask.findUnique({ where: { id: claimed.id } });
      const attempts = (task?.attempts ?? 0) + 1;
      await prisma.cloudinaryCleanupTask.updateMany({
        where: { id: claimed.id, lockToken: token, status: "PROCESSING" },
        data: {
          status: "PENDING",
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7))),
          lockedAt: null,
          lockToken: null,
          lastError: message.slice(0, 2000),
        },
      });
      logger.error("Cloudinary cleanup queued for retry", undefined, {
        taskId: claimed.id,
        resourceType: claimed.resourceType,
        deliveryType: claimed.deliveryType,
        attempt: attempts,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    processed++;
  }
  return processed;
}
