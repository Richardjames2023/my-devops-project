import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  findProduct: vi.fn(),
  countProducts: vi.fn(),
  updateProduct: vi.fn(),
  findVariant: vi.fn(),
  updateVariant: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    category: {
      findUnique: mocks.findCategory,
      create: mocks.createCategory,
      update: mocks.updateCategory,
    },
    product: {
      findUnique: mocks.findProduct,
      count: mocks.countProducts,
      update: mocks.updateProduct,
    },
    productVariant: {
      findUnique: mocks.findVariant,
      update: mocks.updateVariant,
    },
  },
}));

import { AppError } from "../src/common/errors/AppError";
import { updateProduct, setProductActive } from "../src/modules/products/product.service";
import { setCategoryActive } from "../src/modules/products/category.service";
import { updateProductVariant, setProductVariantActive } from "../src/modules/products/product-variant.service";

const productId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";
const categoryId = "f6d1a5b4-6c7e-7d8f-a9b0-1c2d3e4f5a6b";
const variantId = "a7e2b6c5-7d8f-8e9a-b0c1-2d3e4f5a6b7c";

const productRecord = {
  id: productId,
  categoryId,
  name: "Existing product",
  slug: "existing-product",
  description: null,
  basePrice: "100.00",
  hasWarranty: false,
  warrantyDuration: null,
  warrantyTerms: null,
};

describe("product and category lifecycle services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findProduct.mockResolvedValue(productRecord);
    mocks.findCategory.mockResolvedValue({ id: categoryId, isActive: true });
    mocks.countProducts.mockResolvedValue(0);
    mocks.updateProduct.mockResolvedValue({ id: productId });
    mocks.updateCategory.mockResolvedValue({ id: categoryId, isActive: false });
    mocks.findVariant.mockResolvedValue({
      id: variantId,
      sku: "SKU-OLD",
      name: "Existing variant",
      price: "100.00",
      hasWarranty: null,
      warrantyDuration: null,
      warrantyTerms: null,
      product: { isActive: true },
    });
    mocks.updateVariant.mockResolvedValue({ id: variantId });
  });

  it("rejects a product update that enables warranty without a duration", async () => {
    await expect(
      updateProduct(productId, { hasWarranty: true }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Warranty duration is required when warranty is enabled",
    });
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("rejects moving a product into an inactive category", async () => {
    mocks.findCategory.mockResolvedValue({ id: categoryId, isActive: false });

    await expect(
      updateProduct(productId, { categoryId }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("prevents reactivating a product in an inactive category", async () => {
    mocks.findProduct.mockResolvedValue({
      id: productId,
      category: { isActive: false },
    });

    await expect(setProductActive(productId, true)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("prevents category deactivation while active products remain", async () => {
    mocks.countProducts.mockResolvedValue(2);

    await expect(setCategoryActive(categoryId, false)).rejects.toMatchObject({
      statusCode: 409,
      message: "Deactivate or move active products before deactivating this category",
    });
    expect(mocks.updateCategory).not.toHaveBeenCalled();
  });

  it("allows category deactivation when no active products remain", async () => {
    await expect(setCategoryActive(categoryId, false)).resolves.toMatchObject({
      isActive: false,
    });
    expect(mocks.updateCategory).toHaveBeenCalledWith({
      where: { id: categoryId },
      data: { isActive: false },
    });
  });

  it("rejects a variant update that enables its warranty without a duration", async () => {
    await expect(
      updateProductVariant(variantId, { hasWarranty: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateVariant).not.toHaveBeenCalled();
  });

  it("prevents reactivating a variant while its product is inactive", async () => {
    mocks.findVariant.mockResolvedValue({
      id: variantId,
      product: { isActive: false },
    });

    await expect(setProductVariantActive(variantId, true)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.updateVariant).not.toHaveBeenCalled();
  });
});
