import { fileTypeFromBuffer } from "file-type";
import type { Express } from "express";
type EvidenceResourceType = "image" | "video";

import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { getCloudinary } from "../../config/cloudinary";

const ALLOWED_SIGNATURES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

type UploadedAsset = {
  publicId: string;
  resourceType: EvidenceResourceType;
  secureUrl: string;
};

function uploadToCloudinary(
  buffer: Buffer,
  resourceType: EvidenceResourceType,
): Promise<UploadedAsset> {
  const cloudinary = getCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "return-evidence",
        resource_type: resourceType,
        type: "authenticated",
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          console.error("Cloudinary evidence upload failed:", {
            message: error?.message,
            http_code: error?.http_code,
            name: error?.name,
          });

          reject(new AppError("Evidence upload failed", 502));
          return;
        }

        resolve({
          publicId: result.public_id,
          resourceType,
          secureUrl: result.secure_url,
        });
      },
    );

    stream.end(buffer);
  });
}

async function deleteCloudinaryAsset(asset: UploadedAsset): Promise<void> {
  const cloudinary = getCloudinary();

  await cloudinary.uploader.destroy(asset.publicId, {
    resource_type: asset.resourceType,
    type: "authenticated",
    invalidate: true,
  });
}

export async function createReturnEvidence(
  returnRequestId: string,
  userId: string,
  permissions: string[],
  files: Express.Multer.File[],
) {
  if (files.length === 0) {
    throw new AppError("At least one evidence file is required", 400);
  }

  if (files.length > 5) {
    throw new AppError("A maximum of 5 evidence files is allowed", 400);
  }

  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: {
      id: true,
      userId: true,
      status: true,
    },
  });

  if (!returnRequest) {
    throw new AppError("Return request not found", 404);
  }

  const isOwner = returnRequest.userId === userId;
  const canManageOrders = permissions.includes("orders.manage");

  if (!isOwner && !canManageOrders) {
    throw new AppError(
      "You are not allowed to access this return request",
      403,
    );
  }

  if (
    returnRequest.status !== "PENDING" &&
    returnRequest.status !== "UNDER_REVIEW"
  ) {
    throw new AppError(
      "Evidence can only be added to pending or under-review returns",
      400,
    );
  }

  const validatedFiles: Array<{
    file: Express.Multer.File;
    mimeType: string;
    resourceType: EvidenceResourceType;
  }> = [];

  for (const file of files) {
    const detected = await fileTypeFromBuffer(file.buffer);

    if (!detected || !ALLOWED_SIGNATURES.has(detected.mime)) {
      throw new AppError(
        `File "${file.originalname}" is not a supported image or video`,
        400,
      );
    }

    if (detected.mime !== file.mimetype) {
      throw new AppError(
        `File "${file.originalname}" has a mismatched file type`,
        400,
      );
    }

    validatedFiles.push({
      file,
      mimeType: detected.mime,
      resourceType: detected.mime.startsWith("video/") ? "video" : "image",
    });
  }

  const uploadedAssets: UploadedAsset[] = [];

  try {
    for (const file of validatedFiles) {
      const asset = await uploadToCloudinary(
        file.file.buffer,
        file.resourceType,
      );

      uploadedAssets.push(asset);
    }

    return await prisma.$transaction(async (tx) => {
      const currentRequest = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        select: { userId: true, status: true },
      });

      if (!currentRequest) {
        throw new AppError("Return request not found", 404);
      }

      if (currentRequest.userId !== userId && !canManageOrders) {
        throw new AppError(
          "You are not allowed to access this return request",
          403,
        );
      }

      if (
        currentRequest.status !== "PENDING" &&
        currentRequest.status !== "UNDER_REVIEW"
      ) {
        throw new AppError(
          "Evidence can only be added to pending or under-review returns",
          400,
        );
      }

      return Promise.all(
        uploadedAssets.map((asset, index) => {
          const file = validatedFiles[index];

          if (!file) {
            throw new AppError("Evidence upload could not be completed", 500);
          }

          return tx.returnEvidence.create({
            data: {
              returnRequestId,
              url: asset.secureUrl,
              publicId: asset.publicId,
              resourceType: asset.resourceType,
              type: file.mimeType,
              description: file.file.originalname.slice(0, 255),
            },
          });
        }),
      );
    });
  } catch (error) {
    await Promise.allSettled(
      uploadedAssets.map((asset) => deleteCloudinaryAsset(asset)),
    );

    throw error;
  }
}
