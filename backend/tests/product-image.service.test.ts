import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(),
  countImages: vi.fn(),
  findManyImages: vi.fn(),
  findImage: vi.fn(),
  createImage: vi.fn(),
  updateManyImages: vi.fn(),
  updateImage: vi.fn(),
  deleteImage: vi.fn(),
  lockProduct: vi.fn(),
  transaction: vi.fn(),
  uploadStream: vi.fn(),
  destroyAsset: vi.fn(),
  upsertCleanup: vi.fn(),
  deleteManyCleanup: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    product: { findUnique: mocks.findProduct },
    productImage: {
      count: mocks.countImages,
    },
    $transaction: mocks.transaction,
    cloudinaryCleanupTask: { upsert: mocks.upsertCleanup, deleteMany: mocks.deleteManyCleanup },
  },
}));

vi.mock("../src/config/cloudinary", () => ({
  getCloudinary: () => ({
    uploader: {
      upload_stream: mocks.uploadStream,
      destroy: mocks.destroyAsset,
    },
  }),
}));

import {
  createProductImages,
  deleteProductImage,
  listProductImages,
  updateProductImage,
} from "../src/modules/products/product-image.service";

const productId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";
const imageId = "a7e2b6c5-7d8f-8e9a-b0c1-2d3e4f5a6b7c";
const replacementId = "b8f3c7d6-8e9a-9f0b-c1d2-3e4f5a6b7c8d";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=",
  "base64",
);

const imageFile = {
  buffer: tinyPng,
  originalname: "product.png",
  mimetype: "image/png",
} as Express.Multer.File;

const tx = {
  $queryRaw: mocks.lockProduct,
  cloudinaryCleanupTask: { upsert: mocks.upsertCleanup },
  productImage: {
    findMany: mocks.findManyImages,
    findFirst: mocks.findImage,
    create: mocks.createImage,
    updateMany: mocks.updateManyImages,
    update: mocks.updateImage,
    delete: mocks.deleteImage,
  },
};

describe("product image management services", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.findProduct.mockResolvedValue({ id: productId, images: [] });
    mocks.countImages.mockResolvedValue(0);
    mocks.lockProduct.mockResolvedValue([{ id: productId }]);
    mocks.findManyImages.mockResolvedValue([]);
    mocks.findImage.mockResolvedValue({
      id: imageId,
      productId,
      url: "https://res.cloudinary.com/demo/image/upload/front.png",
      publicId: "products/product/front",
      altText: null,
      sortOrder: 0,
      isPrimary: true,
    });
    mocks.createImage.mockResolvedValue({
      id: imageId,
      url: "https://res.cloudinary.com/demo/image/upload/front.png",
      altText: null,
      sortOrder: 0,
      isPrimary: true,
    });
    mocks.updateManyImages.mockResolvedValue({ count: 1 });
    mocks.updateImage.mockResolvedValue({ id: imageId, isPrimary: true });
    mocks.deleteImage.mockResolvedValue({ id: imageId });
    mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.uploadStream.mockImplementation(
      (_options: unknown, callback: (error: unknown, result?: unknown) => void) => ({
        end: () => callback(null, {
          public_id: "products/product/front",
          secure_url: "https://res.cloudinary.com/demo/image/upload/front.png",
        }),
      }),
    );
    mocks.destroyAsset.mockResolvedValue({ result: "ok" });
    mocks.upsertCleanup.mockResolvedValue({ id: "cleanup-id" });
    mocks.deleteManyCleanup.mockResolvedValue({ count: 1 });
  });

  it("lists images in primary and display order", async () => {
    const images = [{ id: imageId, isPrimary: true }];
    mocks.findProduct.mockResolvedValue({ id: productId, images });

    await expect(listProductImages(productId)).resolves.toEqual(images);
  });

  it("rejects an image whose detected file signature does not match the allowed image types", async () => {
    const invalidFile = {
      ...imageFile,
      buffer: Buffer.from("not an image"),
    } as Express.Multer.File;

    await expect(
      createProductImages(productId, [invalidFile]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.uploadStream).not.toHaveBeenCalled();
  });

  it("uploads an image and makes the first image primary", async () => {
    const result = await createProductImages(productId, [imageFile]);

    expect(result).toHaveLength(1);
    expect(mocks.uploadStream).toHaveBeenCalledOnce();
    expect(mocks.createImage).toHaveBeenCalledWith({
      data: {
        productId,
        url: "https://res.cloudinary.com/demo/image/upload/front.png",
        publicId: "products/product/front",
        sortOrder: 0,
        isPrimary: true,
      },
      select: expect.objectContaining({
        id: true,
        url: true,
        isPrimary: true,
      }),
    });
  });

  it("rejects uploads that would exceed the product image limit", async () => {
    mocks.countImages.mockResolvedValue(10);

    await expect(
      createProductImages(productId, [imageFile]),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.uploadStream).not.toHaveBeenCalled();
  });

  it("promotes another image when the current primary image is removed", async () => {
    mocks.findImage.mockResolvedValue({
      id: imageId,
      productId,
      publicId: "products/product/front",
      isPrimary: true,
    });
    mocks.findImage
      .mockResolvedValueOnce({
        id: imageId,
        productId,
        publicId: "products/product/front",
        isPrimary: true,
      })
      .mockResolvedValueOnce({ id: replacementId });

    const result = await deleteProductImage(productId, imageId);

    expect(mocks.updateImage).toHaveBeenCalledWith({
      where: { id: replacementId },
      data: { isPrimary: true },
    });
    expect(mocks.deleteImage).toHaveBeenCalledWith({
      where: { id: imageId },
    });
    expect(mocks.upsertCleanup).toHaveBeenCalledWith(expect.objectContaining({ where: { publicId: "products/product/front" } }));
    expect(mocks.destroyAsset).toHaveBeenCalledWith(
      "products/product/front",
      expect.objectContaining({ resource_type: "image" }),
    );
    expect(result).toMatchObject({
      id: imageId,
      deleted: true,
      cloudinaryCleanupPending: false,
    });
  });

  it("makes a different image primary when requested", async () => {
    mocks.findImage.mockResolvedValue({
      id: imageId,
      productId,
      isPrimary: false,
      publicId: "products/product/back",
    });

    await updateProductImage(productId, imageId, { isPrimary: true });

    expect(mocks.updateManyImages).toHaveBeenCalledWith({
      where: { productId, isPrimary: true },
      data: { isPrimary: false },
    });
    expect(mocks.updateImage).toHaveBeenCalledWith({
      where: { id: imageId },
      data: { isPrimary: true },
      select: expect.objectContaining({ id: true, isPrimary: true }),
    });
  });

  it("logs Cloudinary cleanup failures when the image database transaction fails", async () => {
    const cleanupError = new Error("Cloudinary unavailable");
    const databaseError = new Error("Database write failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.transaction.mockRejectedValueOnce(databaseError);
    mocks.destroyAsset.mockRejectedValueOnce(cleanupError);

    await expect(
      createProductImages(productId, [imageFile]),
    ).rejects.toBe(databaseError);

    expect(errorSpy).toHaveBeenCalledWith(
      "Cloudinary product image cleanup failed after a database write error:",
      {
        publicId: "products/product/front",
        message: "Cloudinary unavailable",
      },
    );

    errorSpy.mockRestore();
  });

  it("reports pending Cloudinary cleanup without losing the database deletion", async () => {
    mocks.findImage.mockResolvedValue({
      id: imageId,
      productId,
      publicId: "products/product/front",
      isPrimary: false,
    });
    mocks.destroyAsset.mockRejectedValue(new Error("Cloudinary unavailable"));

    const result = await deleteProductImage(productId, imageId);

    expect(mocks.deleteImage).toHaveBeenCalled();
    expect(mocks.upsertCleanup).toHaveBeenCalled();
    expect(result.cloudinaryCleanupPending).toBe(true);
  });
});
