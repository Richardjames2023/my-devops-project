import { fileTypeFromBuffer } from "file-type";
import type { Express } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { getCloudinary } from "../../config/cloudinary";
import type { UpdateProductImageInput } from "./product-image.validation";
import { MAX_PRODUCT_IMAGES } from "./product-image.upload";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

type UploadedProductAsset = {
  publicId: string;
  secureUrl: string;
};

function uploadToCloudinary(
  productId: string,
  buffer: Buffer,
): Promise<UploadedProductAsset> {
  const cloudinary = getCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `products/${productId}`,
        resource_type: "image",
        type: "upload",
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          console.error("Cloudinary product image upload failed:", {
            message: error?.message,
            http_code: error?.http_code,
            name: error?.name,
          });
          reject(new AppError("Product image upload failed", 502));
          return;
        }

        resolve({
          publicId: result.public_id,
          secureUrl: result.secure_url,
        });
      },
    );

    stream.end(buffer);
  });
}

async function deleteCloudinaryAsset(publicId: string): Promise<void> {
  const cloudinary = getCloudinary();
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "upload",
    invalidate: true,
  });

  if (result.result !== "ok" && result.result !== "not found") {
    throw new AppError("Cloudinary image cleanup could not be confirmed", 502);
  }
}

async function validateImageFiles(files: Express.Multer.File[]) {
  if (files.length === 0) {
    throw new AppError("Upload at least one product image", 400);
  }

  if (files.length > MAX_PRODUCT_IMAGES) {
    throw new AppError("A product can have a maximum of 10 images", 400);
  }

  const validated: Express.Multer.File[] = [];

  for (const file of files) {
    const detected = await fileTypeFromBuffer(file.buffer);

    if (!detected || !ALLOWED_IMAGE_TYPES.has(detected.mime)) {
      throw new AppError(
        `File "${file.originalname}" is not a supported image`,
        400,
      );
    }

    if (detected.mime !== file.mimetype) {
      throw new AppError(
        `File "${file.originalname}" has a mismatched file type`,
        400,
      );
    }

    validated.push(file);
  }

  return validated;
}

export async function listProductImages(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      images: {
        orderBy: [
          { isPrimary: "desc" },
          { sortOrder: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: {
          id: true,
          url: true,
          altText: true,
          sortOrder: true,
          isPrimary: true,
          createdAt: true,
        },
      },
    },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  return product.images;
}

export async function createProductImages(
  productId: string,
  files: Express.Multer.File[],
) {
  const validatedFiles = await validateImageFiles(files);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const currentCount = await prisma.productImage.count({
    where: { productId },
  });

  if (currentCount + validatedFiles.length > MAX_PRODUCT_IMAGES) {
    throw new AppError("A product can have a maximum of 10 images", 409);
  }

  const uploadedAssets: UploadedProductAsset[] = [];

  try {
    for (const file of validatedFiles) {
      uploadedAssets.push(
        await uploadToCloudinary(productId, file.buffer),
      );
    }

    return await prisma.$transaction(async (tx) => {
      const lockedProducts = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`,
      );

      if (lockedProducts.length === 0) {
        throw new AppError("Product not found", 404);
      }

      const existingImages = await tx.productImage.findMany({
        where: { productId },
        orderBy: [{ sortOrder: "desc" }, { createdAt: "asc" }],
        select: { sortOrder: true, isPrimary: true },
      });

      if (existingImages.length + uploadedAssets.length > MAX_PRODUCT_IMAGES) {
        throw new AppError("A product can have a maximum of 10 images", 409);
      }

      let nextSortOrder =
        existingImages.reduce(
          (highest, image) => Math.max(highest, image.sortOrder),
          -1,
        ) + 1;
      let hasPrimary = existingImages.some((image) => image.isPrimary);

      const created = [];

      for (const asset of uploadedAssets) {
        const image = await tx.productImage.create({
          data: {
            productId,
            url: asset.secureUrl,
            publicId: asset.publicId,
            sortOrder: nextSortOrder,
            isPrimary: !hasPrimary,
          },
          select: {
            id: true,
            url: true,
            altText: true,
            sortOrder: true,
            isPrimary: true,
            createdAt: true,
          },
        });

        created.push(image);
        nextSortOrder += 1;
        hasPrimary = true;
      }

      return created;
    });
  } catch (error) {
    await Promise.allSettled(
      uploadedAssets.map((asset) => deleteCloudinaryAsset(asset.publicId)),
    );
    throw error;
  }
}

export async function updateProductImage(
  productId: string,
  imageId: string,
  input: UpdateProductImageInput,
) {
  return prisma.$transaction(async (tx) => {
    const lockedProducts = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`,
    );

    if (lockedProducts.length === 0) {
      throw new AppError("Product not found", 404);
    }

    const currentImage = await tx.productImage.findFirst({
      where: { id: imageId, productId },
    });

    if (!currentImage) {
      throw new AppError("Product image not found", 404);
    }

    if (input.isPrimary === true) {
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    if (input.isPrimary === false && currentImage.isPrimary) {
      const replacement = await tx.productImage.findFirst({
        where: { productId, id: { not: imageId } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });

      if (!replacement) {
        throw new AppError(
          "A product must retain one primary image; upload another image first",
          400,
        );
      }

      await tx.productImage.update({
        where: { id: replacement.id },
        data: { isPrimary: true },
      });
    }

    const data: Prisma.ProductImageUpdateInput = {};

    if (input.altText !== undefined) data.altText = input.altText;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;

    return tx.productImage.update({
      where: { id: imageId },
      data,
      select: {
        id: true,
        url: true,
        altText: true,
        sortOrder: true,
        isPrimary: true,
        createdAt: true,
      },
    });
  });
}

export async function deleteProductImage(productId: string, imageId: string) {
  const deletedImage = await prisma.$transaction(async (tx) => {
    const lockedProducts = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`,
    );

    if (lockedProducts.length === 0) {
      throw new AppError("Product not found", 404);
    }

    const image = await tx.productImage.findFirst({
      where: { id: imageId, productId },
    });

    if (!image) {
      throw new AppError("Product image not found", 404);
    }

    if (image.isPrimary) {
      const replacement = await tx.productImage.findFirst({
        where: { productId, id: { not: imageId } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });

      if (replacement) {
        await tx.productImage.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
      }
    }

    await tx.productImage.delete({ where: { id: imageId } });
    return image;
  });

  let cloudinaryCleanupPending = false;

  if (deletedImage.publicId) {
    try {
      await deleteCloudinaryAsset(deletedImage.publicId);
    } catch (error) {
      cloudinaryCleanupPending = true;
      console.error("Product image was removed from the database but Cloudinary cleanup failed:", {
        productImageId: deletedImage.id,
        publicId: deletedImage.publicId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    id: deletedImage.id,
    deleted: true,
    cloudinaryCleanupPending,
  };
}
