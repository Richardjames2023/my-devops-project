import { fileTypeFromBuffer } from "file-type";
import type { Express } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { getCloudinary } from "../../config/cloudinary";
import { enqueueCloudinaryCleanup, deleteCloudinaryAsset } from "../../infrastructure/cloudinary/cloudinary-cleanup";
import { createAuditLog } from "../../common/utils/audit-log";
import { logger } from "../../config/logger";
import type { CreateBannerInput, UpdateBannerInput } from "./promotion-banner.validation";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
type Asset = { publicId: string; url: string };

async function uploadImage(file: Express.Multer.File, folder: string): Promise<Asset> {
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !ALLOWED.has(detected.mime) || detected.mime !== file.mimetype) {
    throw new AppError("Uploaded file is not a supported image", 400);
  }
  const cloudinary = getCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", type: "upload", overwrite: false },
      (error, result) => {
        if (error || !result) {
          logger.error("Promotion banner image upload failed", undefined, { errorName: error?.name ?? "UnknownError" });
          reject(new AppError("Banner image upload failed", 502));
          return;
        }
        resolve({ publicId: result.public_id, url: result.secure_url });
      },
    );
    stream.end(file.buffer);
  });
}

async function cleanupAsset(asset: Asset): Promise<void> {
  try {
    await deleteCloudinaryAsset(asset.publicId);
  } catch (error) {
    try { await enqueueCloudinaryCleanup(asset.publicId); }
    catch (queueError) {
      logger.error("Promotion banner image cleanup could not be queued", undefined, {
        errorName: queueError instanceof Error ? queueError.name : "UnknownError",
      });
    }
    logger.error("Promotion banner image cleanup failed", undefined, {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function auditMetadata(metadata: { ipAddress?: string; userAgent?: string }) {
  return metadata;
}

export async function createBanner(
  input: CreateBannerInput, file: Express.Multer.File | undefined, staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  if (!file) throw new AppError("A banner image is required", 400);
  const asset = await uploadImage(file, "promotions/banners");
  try {
    return await prisma.$transaction(async (tx) => {
      const banner = await tx.promotionBanner.create({
        data: {
          title: input.title, position: input.position, startAt: new Date(input.startAt),
          endAt: new Date(input.endAt), targetUrl: input.targetUrl ?? null,
          altText: input.altText ?? null, priority: input.priority, status: input.status,
          imageUrl: asset.url, publicId: asset.publicId, createdByStaffAccountId: staffId,
        },
      });
      await createAuditLog(tx, {
        staffAccountId: staffId, action: "PROMOTION_BANNER_CREATED",
        entity: "PromotionBanner", entityId: banner.id,
        newValues: {
          title: banner.title, position: banner.position, startAt: banner.startAt.toISOString(),
          endAt: banner.endAt.toISOString(), status: banner.status, priority: banner.priority,
        },
        ...auditMetadata(metadata),
      });
      return banner;
    });
  } catch (error) {
    await cleanupAsset(asset);
    throw error;
  }
}

export async function listBanners(query: {
  position?: "HERO" | "TOP" | "BOTTOM";
  status?: "DRAFT" | "PUBLISHED" | "PAUSED";
  page: number; limit: number;
}) {
  const where: Prisma.PromotionBannerWhereInput = {
    ...(query.position ? { position: query.position } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [banners, total] = await prisma.$transaction([
    prisma.promotionBanner.findMany({
      where, orderBy: [{ position: "asc" }, { priority: "desc" }, { startAt: "asc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.limit, take: query.limit,
    }),
    prisma.promotionBanner.count({ where }),
  ]);
  return { banners, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getBanner(id: string) {
  const banner = await prisma.promotionBanner.findUnique({ where: { id } });
  if (!banner) throw new AppError("Promotion banner not found", 404);
  return banner;
}

export async function updateBanner(
  id: string, input: UpdateBannerInput, file: Express.Multer.File | undefined,
  staffId: string, metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  const existing = await getBanner(id);
  const asset = file ? await uploadImage(file, "promotions/banners") : undefined;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const nextStart = input.startAt === undefined ? existing.startAt : new Date(input.startAt);
      const nextEnd = input.endAt === undefined ? existing.endAt : new Date(input.endAt);
      if (nextEnd <= nextStart) throw new AppError("End date must be later than start date", 400);
      const banner = await tx.promotionBanner.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.startAt !== undefined ? { startAt: nextStart } : {}),
          ...(input.endAt !== undefined ? { endAt: nextEnd } : {}),
          ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl } : {}),
          ...(input.altText !== undefined ? { altText: input.altText } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(asset ? { imageUrl: asset.url, publicId: asset.publicId } : {}),
        },
      });
      await createAuditLog(tx, {
        staffAccountId: staffId, action: "PROMOTION_BANNER_UPDATED",
        entity: "PromotionBanner", entityId: id,
        oldValues: { title: existing.title, position: existing.position, status: existing.status, startAt: existing.startAt.toISOString(), endAt: existing.endAt.toISOString() },
        newValues: { title: banner.title, position: banner.position, status: banner.status, startAt: banner.startAt.toISOString(), endAt: banner.endAt.toISOString() },
        ...auditMetadata(metadata),
      });
      return banner;
    });
    if (asset) await cleanupAsset({ publicId: existing.publicId, url: existing.imageUrl });
    return updated;
  } catch (error) {
    if (asset) await cleanupAsset(asset);
    throw error;
  }
}

export async function deleteBanner(id: string, staffId: string, metadata: { ipAddress?: string; userAgent?: string } = {}) {
  const banner = await getBanner(id);
  await prisma.$transaction(async (tx) => {
    await enqueueCloudinaryCleanup(banner.publicId, tx);
    await tx.promotionBanner.delete({ where: { id } });
    await createAuditLog(tx, {
      staffAccountId: staffId, action: "PROMOTION_BANNER_DELETED",
      entity: "PromotionBanner", entityId: id,
      oldValues: { title: banner.title, position: banner.position, publicId: banner.publicId },
      ...auditMetadata(metadata),
    });
  });
  return { id, deleted: true, cloudinaryCleanupQueued: true };
}

export async function setDefaultBanner(
  position: "HERO" | "TOP" | "BOTTOM", file: Express.Multer.File | undefined,
  targetUrl: string | null, altText: string | null, staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  if (!file) throw new AppError("A default banner image is required", 400);
  const asset = await uploadImage(file, "promotions/defaults");
  try {
    const existing = await prisma.promotionBannerDefault.findUnique({ where: { position } });
    const result = await prisma.$transaction(async (tx) => {
      const value = await tx.promotionBannerDefault.upsert({
        where: { position },
        create: { position, imageUrl: asset.url, publicId: asset.publicId, targetUrl, altText, updatedByStaffAccountId: staffId },
        update: { imageUrl: asset.url, publicId: asset.publicId, targetUrl, altText, updatedByStaffAccountId: staffId },
      });
      await createAuditLog(tx, {
        staffAccountId: staffId, action: existing ? "PROMOTION_BANNER_DEFAULT_UPDATED" : "PROMOTION_BANNER_DEFAULT_CREATED",
        entity: "PromotionBannerDefault", entityId: value.id,
        newValues: { position, targetUrl, altText },
        ...auditMetadata(metadata),
      });
      return value;
    });
    if (existing) await cleanupAsset({ publicId: existing.publicId, url: existing.imageUrl });
    return result;
  } catch (error) {
    await cleanupAsset(asset);
    throw error;
  }
}

export async function deleteDefaultBanner(position: "HERO" | "TOP" | "BOTTOM", staffId: string) {
  const existing = await prisma.promotionBannerDefault.findUnique({ where: { position } });
  if (!existing) throw new AppError("Default banner not found", 404);
  await prisma.$transaction(async (tx) => {
    await enqueueCloudinaryCleanup(existing.publicId, tx);
    await tx.promotionBannerDefault.delete({ where: { position } });
    await createAuditLog(tx, {
      staffAccountId: staffId, action: "PROMOTION_BANNER_DEFAULT_DELETED",
      entity: "PromotionBannerDefault", entityId: existing.id,
      oldValues: { position },
    });
  });
  return { position, deleted: true, cloudinaryCleanupQueued: true };
}

export async function getPublicBanners() {
  const now = new Date();
  const [scheduled, defaults] = await Promise.all([
    prisma.promotionBanner.findMany({
      where: { status: "PUBLISHED", startAt: { lte: now }, endAt: { gt: now } },
      orderBy: [{ priority: "desc" }, { startAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.promotionBannerDefault.findMany(),
  ]);
  const output: Record<string, unknown> = { hero: null, top: null, bottom: null };
  const positions = ["HERO", "TOP", "BOTTOM"] as const;
  for (const position of positions) {
    const banner = scheduled.find((item) => item.position === position);
    const fallback = defaults.find((item) => item.position === position);
    const key = position.toLowerCase();
    if (banner) output[key] = {
      type: "scheduled", id: banner.id, title: banner.title, imageUrl: banner.imageUrl,
      mobileImageUrl: banner.mobileImageUrl, altText: banner.altText,
      targetUrl: banner.targetUrl, startsAt: banner.startAt, endsAt: banner.endAt,
    };
    else if (fallback) output[key] = {
      type: "default", imageUrl: fallback.imageUrl, mobileImageUrl: fallback.mobileImageUrl,
      altText: fallback.altText, targetUrl: fallback.targetUrl,
    };
  }
  return output;
}
