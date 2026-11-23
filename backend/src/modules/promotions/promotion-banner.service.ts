
import { fileTypeFromBuffer } from "file-type";
import type { Express } from "express";
import { Prisma, PromotionBanner } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { getCloudinary } from "../../config/cloudinary";
import {
  enqueueCloudinaryCleanup,
  deleteCloudinaryAsset,
} from "../../infrastructure/cloudinary/cloudinary-cleanup";
import { createAuditLog } from "../../common/utils/audit-log";
import { logger } from "../../config/logger";
import type {
  BannerContentInput,
  CreateBannerInput,
  UpdateBannerInput,
} from "./promotion-banner.validation";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

type Asset = {
  publicId: string;
  url: string;
};

async function uploadImage(
  file: Express.Multer.File,
  folder: string,
): Promise<Asset> {
  const detected = await fileTypeFromBuffer(file.buffer);

  if (
    !detected ||
    !ALLOWED.has(detected.mime) ||
    detected.mime !== file.mimetype
  ) {
    throw new AppError("Uploaded file is not a supported image", 400);
  }

  const cloudinary = getCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        type: "upload",
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          logger.error(
            "Promotion banner image upload failed",
            undefined,
            {
              errorName: error?.name ?? "UnknownError",
            },
          );

          reject(new AppError("Banner image upload failed", 502));
          return;
        }

        resolve({
          publicId: result.public_id,
          url: result.secure_url,
        });
      },
    );

    stream.end(file.buffer);
  });
}

async function cleanupAsset(asset: Asset): Promise<void> {
  try {
    await deleteCloudinaryAsset(asset.publicId);
  } catch (error) {
    logger.error(
      "Promotion banner image cleanup failed",
      error,
      {
        publicId: asset.publicId,
        stage: "cloudinary_deletion",
      },
    );

    try {
      await enqueueCloudinaryCleanup(asset.publicId);
    } catch (queueError) {
      logger.error(
        "CRITICAL: Promotion banner cleanup could not be queued",
        queueError,
        {
          publicId: asset.publicId,
          stage: "cleanup_queue_insertion",
          requiresManualRecovery: true,
        },
      );
    }
  }
}

function auditMetadata(metadata: {
  ipAddress?: string;
  userAgent?: string;
}) {
  return metadata;
}

export async function createBanner(
  input: CreateBannerInput,
  file: Express.Multer.File | undefined,
  staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
  mobileFile?: Express.Multer.File,
) {
  if (!file) throw new AppError("A banner image is required", 400);

  const asset = await uploadImage(file, "promotions/banners");
  let mobileAsset: Asset | undefined;

  try {
    if (mobileFile) mobileAsset = await uploadImage(mobileFile, "promotions/banners/mobile");
    return await prisma.$transaction(async (tx) => {
      const banner = await tx.promotionBanner.create({
        data: {
          title: input.title,
          position: input.position,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          targetUrl: input.targetUrl ?? null,
          altText: input.altText ?? null,
          eyebrow: input.eyebrow ?? null,
          headline: input.headline ?? null,
          description: input.description ?? null,
          badgeText: input.badgeText ?? null,
          primaryCtaLabel: input.primaryCtaLabel ?? null,
          primaryCtaUrl: input.primaryCtaUrl ?? null,
          secondaryCtaLabel: input.secondaryCtaLabel ?? null,
          secondaryCtaUrl: input.secondaryCtaUrl ?? null,
          priority: input.priority,
          status: input.status,
          imageUrl: asset.url,
          publicId: asset.publicId,
          ...(mobileAsset ? { mobileImageUrl: mobileAsset.url, mobilePublicId: mobileAsset.publicId } : {}),
          createdByStaffAccountId: staffId,
        },
      });

      await createAuditLog(tx, {
        staffAccountId: staffId,
        action: "PROMOTION_BANNER_CREATED",
        entity: "PromotionBanner",
        entityId: banner.id,
        newValues: {
          title: banner.title,
          position: banner.position,
          startAt: banner.startAt.toISOString(),
          endAt: banner.endAt.toISOString(),
          targetUrl: banner.targetUrl,
          altText: banner.altText,
          eyebrow: banner.eyebrow,
          headline: banner.headline,
          description: banner.description,
          badgeText: banner.badgeText,
          primaryCtaLabel: banner.primaryCtaLabel,
          primaryCtaUrl: banner.primaryCtaUrl,
          secondaryCtaLabel: banner.secondaryCtaLabel,
          secondaryCtaUrl: banner.secondaryCtaUrl,
          priority: banner.priority,
          status: banner.status,
        },
        ...auditMetadata(metadata),
      });

      return banner;
    });
  } catch (error) {
    await cleanupAsset(asset);
    if (mobileAsset) await cleanupAsset(mobileAsset);
    throw error;
  }
}

export async function listBanners(query: {
  position?: "HERO" | "TOP" | "BOTTOM";
  status?: "DRAFT" | "PUBLISHED" | "PAUSED";
  page: number;
  limit: number;
}) {
  const where: Prisma.PromotionBannerWhereInput = {
    ...(query.position ? { position: query.position } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [banners, total] = await prisma.$transaction([
    prisma.promotionBanner.findMany({
      where,
      orderBy: [
        { position: "asc" },
        { priority: "desc" },
        { startAt: "asc" },
        { createdAt: "desc" },
      ],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.promotionBanner.count({ where }),
  ]);

  return {
    banners,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getBanner(id: string) {
  const banner = await prisma.promotionBanner.findUnique({
    where: { id },
  });

  if (!banner) {
    throw new AppError("Promotion banner not found", 404);
  }

  return banner;
}

export async function updateBanner(
  id: string,
  input: UpdateBannerInput,
  file: Express.Multer.File | undefined,
  staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
  mobileFile?: Express.Multer.File,
) {
  const asset = file ? await uploadImage(file, "promotions/banners") : undefined;
  let mobileAsset: Asset | undefined;

  try {
    if (mobileFile) mobileAsset = await uploadImage(mobileFile, "promotions/banners/mobile");
    return await prisma.$transaction(async (tx) => {
      // Serialize update/delete operations for this banner and read the asset
      // identifiers only after acquiring the row lock.
      await tx.$queryRaw`SELECT id FROM promotion_banners WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.promotionBanner.findUnique({ where: { id } });
      if (!existing) throw new AppError("Promotion banner not found", 404);

      const nextStart = input.startAt === undefined ? existing.startAt : new Date(input.startAt);
      const nextEnd = input.endAt === undefined ? existing.endAt : new Date(input.endAt);
      if (nextEnd <= nextStart) {
        throw new AppError("End date must be later than start date", 400);
      }

      const banner = await tx.promotionBanner.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.startAt !== undefined ? { startAt: nextStart } : {}),
          ...(input.endAt !== undefined ? { endAt: nextEnd } : {}),
          ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl } : {}),
          ...(input.altText !== undefined ? { altText: input.altText } : {}),
          ...(input.eyebrow !== undefined ? { eyebrow: input.eyebrow } : {}),
          ...(input.headline !== undefined ? { headline: input.headline } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.badgeText !== undefined ? { badgeText: input.badgeText } : {}),
          ...(input.primaryCtaLabel !== undefined ? { primaryCtaLabel: input.primaryCtaLabel } : {}),
          ...(input.primaryCtaUrl !== undefined ? { primaryCtaUrl: input.primaryCtaUrl } : {}),
          ...(input.secondaryCtaLabel !== undefined ? { secondaryCtaLabel: input.secondaryCtaLabel } : {}),
          ...(input.secondaryCtaUrl !== undefined ? { secondaryCtaUrl: input.secondaryCtaUrl } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(asset ? { imageUrl: asset.url, publicId: asset.publicId } : {}),
          ...(mobileAsset ? { mobileImageUrl: mobileAsset.url, mobilePublicId: mobileAsset.publicId } : {}),
        },
      });

      if (asset) await enqueueCloudinaryCleanup(existing.publicId, tx);
      if (mobileAsset && existing.mobilePublicId) await enqueueCloudinaryCleanup(existing.mobilePublicId, tx);

      await createAuditLog(tx, {
        staffAccountId: staffId,
        action: "PROMOTION_BANNER_UPDATED",
        entity: "PromotionBanner",
        entityId: id,
        oldValues: {
          title: existing.title,
          position: existing.position,
          startAt: existing.startAt.toISOString(),
          endAt: existing.endAt.toISOString(),
          targetUrl: existing.targetUrl,
          altText: existing.altText,
          eyebrow: existing.eyebrow,
          headline: existing.headline,
          description: existing.description,
          badgeText: existing.badgeText,
          primaryCtaLabel: existing.primaryCtaLabel,
          primaryCtaUrl: existing.primaryCtaUrl,
          secondaryCtaLabel: existing.secondaryCtaLabel,
          secondaryCtaUrl: existing.secondaryCtaUrl,
          priority: existing.priority,
          status: existing.status,
          imageReplaced: false,
        },
        newValues: {
          title: banner.title,
          position: banner.position,
          startAt: banner.startAt.toISOString(),
          endAt: banner.endAt.toISOString(),
          targetUrl: banner.targetUrl,
          altText: banner.altText,
          eyebrow: banner.eyebrow,
          headline: banner.headline,
          description: banner.description,
          badgeText: banner.badgeText,
          primaryCtaLabel: banner.primaryCtaLabel,
          primaryCtaUrl: banner.primaryCtaUrl,
          secondaryCtaLabel: banner.secondaryCtaLabel,
          secondaryCtaUrl: banner.secondaryCtaUrl,
          priority: banner.priority,
          status: banner.status,
          imageReplaced: Boolean(asset),
          mobileImageReplaced: Boolean(mobileAsset),
        },
        ...auditMetadata(metadata),
      });
      return banner;
    });
  } catch (error) {
    if (asset) await cleanupAsset(asset);
    if (mobileAsset) await cleanupAsset(mobileAsset);
    throw error;
  }
}

export async function deleteBanner(
  id: string,
  staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM promotion_banners WHERE id = ${id}::uuid FOR UPDATE`;
    const banner = await tx.promotionBanner.findUnique({ where: { id } });
    if (!banner) throw new AppError("Promotion banner not found", 404);

    await enqueueCloudinaryCleanup(banner.publicId, tx);
    if (banner.mobilePublicId) await enqueueCloudinaryCleanup(banner.mobilePublicId, tx);
    await tx.promotionBanner.delete({ where: { id } });

    await createAuditLog(tx, {
      staffAccountId: staffId,
      action: "PROMOTION_BANNER_DELETED",
      entity: "PromotionBanner",
      entityId: id,
      oldValues: {
        title: banner.title,
        position: banner.position,
        publicId: banner.publicId,
        mobilePublicId: banner.mobilePublicId,
      },
      ...auditMetadata(metadata),
    });
  });

  return { id, deleted: true, cloudinaryCleanupQueued: true };
}

export async function setDefaultBanner(
  position: "HERO" | "TOP" | "BOTTOM",
  file: Express.Multer.File | undefined,
  targetUrl: string | null,
  altText: string | null,
  content: BannerContentInput,
  staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
  mobileFile?: Express.Multer.File,
) {
  if (!file) throw new AppError("A default banner image is required", 400);
  const asset = await uploadImage(file, "promotions/defaults");
  let mobileAsset: Asset | undefined;

  try {
    if (mobileFile) mobileAsset = await uploadImage(mobileFile, "promotions/defaults/mobile");
    return await prisma.$transaction(async (tx) => {
      // Advisory locking also serializes first-time inserts when no default row exists.
      await tx.$queryRaw`WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(${`promotion-banner-default:${position}`}))) SELECT 1 AS locked FROM lock`;
      const existing = await tx.promotionBannerDefault.findUnique({ where: { position } });
      const value = await tx.promotionBannerDefault.upsert({
        where: { position },
        create: {
          position, imageUrl: asset.url, publicId: asset.publicId,
          ...(mobileAsset ? { mobileImageUrl: mobileAsset.url, mobilePublicId: mobileAsset.publicId } : {}),
          targetUrl, altText,
          eyebrow: content.eyebrow ?? null,
          headline: content.headline ?? null,
          description: content.description ?? null,
          badgeText: content.badgeText ?? null,
          primaryCtaLabel: content.primaryCtaLabel ?? null,
          primaryCtaUrl: content.primaryCtaUrl ?? null,
          secondaryCtaLabel: content.secondaryCtaLabel ?? null,
          secondaryCtaUrl: content.secondaryCtaUrl ?? null,
          updatedByStaffAccountId: staffId,
        },
        update: {
          imageUrl: asset.url, publicId: asset.publicId,
          ...(mobileAsset ? { mobileImageUrl: mobileAsset.url, mobilePublicId: mobileAsset.publicId } : {}),
          targetUrl, altText,
          eyebrow: content.eyebrow ?? null,
          headline: content.headline ?? null,
          description: content.description ?? null,
          badgeText: content.badgeText ?? null,
          primaryCtaLabel: content.primaryCtaLabel ?? null,
          primaryCtaUrl: content.primaryCtaUrl ?? null,
          secondaryCtaLabel: content.secondaryCtaLabel ?? null,
          secondaryCtaUrl: content.secondaryCtaUrl ?? null,
          updatedByStaffAccountId: staffId,
        },
      });

      if (existing) {
        await enqueueCloudinaryCleanup(existing.publicId, tx);
        if (mobileAsset && existing.mobilePublicId) await enqueueCloudinaryCleanup(existing.mobilePublicId, tx);
      }
      await createAuditLog(tx, {
        staffAccountId: staffId,
        action: existing ? "PROMOTION_BANNER_DEFAULT_UPDATED" : "PROMOTION_BANNER_DEFAULT_CREATED",
        entity: "PromotionBannerDefault",
        entityId: value.id,
        ...(existing ? {
          oldValues: {
            position: existing.position,
            targetUrl: existing.targetUrl,
            altText: existing.altText,
          },
        } : {}),
        newValues: {
          position, targetUrl, altText,
          eyebrow: value.eyebrow, headline: value.headline,
          description: value.description, badgeText: value.badgeText,
          primaryCtaLabel: value.primaryCtaLabel, primaryCtaUrl: value.primaryCtaUrl,
          secondaryCtaLabel: value.secondaryCtaLabel, secondaryCtaUrl: value.secondaryCtaUrl,
        },
        ...auditMetadata(metadata),
      });
      return value;
    });
  } catch (error) {
    await cleanupAsset(asset);
    if (mobileAsset) await cleanupAsset(mobileAsset);
    throw error;
  }
}

export async function deleteDefaultBanner(
  position: "HERO" | "TOP" | "BOTTOM",
  staffId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(${`promotion-banner-default:${position}`}))) SELECT 1 AS locked FROM lock`;
    const existing = await tx.promotionBannerDefault.findUnique({ where: { position } });
    if (!existing) throw new AppError("Default banner not found", 404);

    await enqueueCloudinaryCleanup(existing.publicId, tx);
    if (existing.mobilePublicId) await enqueueCloudinaryCleanup(existing.mobilePublicId, tx);
    await tx.promotionBannerDefault.delete({ where: { position } });
    await createAuditLog(tx, {
      staffAccountId: staffId,
      action: "PROMOTION_BANNER_DEFAULT_DELETED",
      entity: "PromotionBannerDefault",
      entityId: existing.id,
      oldValues: { position, publicId: existing.publicId, mobilePublicId: existing.mobilePublicId },
      ...auditMetadata(metadata),
    });
  });
  return { position, deleted: true, cloudinaryCleanupQueued: true };
}

export async function getPublicBanners() {
  // Promotion schedule columns are PostgreSQL TIMESTAMP WITHOUT TIME ZONE.
  // Store and compare their values as UTC wall-clock timestamps to avoid the
  // session timezone (e.g. Africa/Lagos) shifting NOW() during comparisons.
  const [scheduled, defaults] = await Promise.all([
    prisma.$queryRaw<PromotionBanner[]>`
      SELECT *
      FROM promotion_banners
      WHERE status = 'PUBLISHED'::"PromotionBannerStatus"
        AND "startAt" <= timezone('UTC', NOW())
        AND "endAt" > timezone('UTC', NOW())
      ORDER BY priority DESC, "startAt" DESC, "createdAt" DESC
    `,
    prisma.promotionBannerDefault.findMany(),
  ]);

  const output: Record<string, unknown> = {
    hero: null,
    top: null,
    bottom: null,
  };

  const positions = ["HERO", "TOP", "BOTTOM"] as const;

  for (const position of positions) {
    const banner = scheduled.find(
      (item) => item.position === position,
    );

    const fallback = defaults.find(
      (item) => item.position === position,
    );

    const key = position.toLowerCase();

    if (banner) {
      output[key] = {
        type: "scheduled",
        id: banner.id,
        title: banner.title,
        imageUrl: banner.imageUrl,
        mobileImageUrl: banner.mobileImageUrl,
        altText: banner.altText,
        targetUrl: banner.targetUrl,
        eyebrow: banner.eyebrow,
        headline: banner.headline,
        description: banner.description,
        badge: banner.badgeText ? { text: banner.badgeText } : null,
        primaryCta: banner.primaryCtaLabel && banner.primaryCtaUrl
          ? { label: banner.primaryCtaLabel, url: banner.primaryCtaUrl }
          : null,
        secondaryCta: banner.secondaryCtaLabel && banner.secondaryCtaUrl
          ? { label: banner.secondaryCtaLabel, url: banner.secondaryCtaUrl }
          : null,
        startsAt: banner.startAt,
        endsAt: banner.endAt,
      };
    } else if (fallback) {
      output[key] = {
        type: "default",
        imageUrl: fallback.imageUrl,
        mobileImageUrl: fallback.mobileImageUrl,
        altText: fallback.altText,
        targetUrl: fallback.targetUrl,
        eyebrow: fallback.eyebrow,
        headline: fallback.headline,
        description: fallback.description,
        badge: fallback.badgeText ? { text: fallback.badgeText } : null,
        primaryCta: fallback.primaryCtaLabel && fallback.primaryCtaUrl
          ? { label: fallback.primaryCtaLabel, url: fallback.primaryCtaUrl }
          : null,
        secondaryCta: fallback.secondaryCtaLabel && fallback.secondaryCtaUrl
          ? { label: fallback.secondaryCtaLabel, url: fallback.secondaryCtaUrl }
          : null,
      };
    }
  }

  return output;
}
