import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn();
  const findCategory = vi.fn();
  const updateCategory = vi.fn();
  const findProduct = vi.fn();
  const countProducts = vi.fn();
  const updateProduct = vi.fn();
  const findVariant = vi.fn();
  const updateVariant = vi.fn();

  const tx = {
    $queryRaw: queryRaw,
    category: {
      findUnique: findCategory,
      update: updateCategory,
    },
    product: {
      findUnique: findProduct,
      count: countProducts,
      update: updateProduct,
    },
    productVariant: {
      findUnique: findVariant,
      update: updateVariant,
    },
  };

  return {
    queryRaw,
    findCategory,
    updateCategory,
    findProduct,
    countProducts,
    updateProduct,
    findVariant,
    updateVariant,
    tx,
    transaction: vi.fn(),
  };
});

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    $transaction: mocks.transaction,
    category: {
      findUnique: mocks.findCategory,
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

import {
  updateProduct,
  setProductActive,
} from "../src/modules/products/product.service";
import { setCategoryActive } from "../src/modules/products/category.service";
import {
  updateProductVariant,
  setProductVariantActive,
} from "../src/modules/products/product-variant.service";

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
  isActive: true,
};

describe("product and category lifecycle services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.queryRaw.mockResolvedValue([{ id: categoryId, isActive: true }]);
    mocks.findProduct.mockResolvedValue(productRecord);
    mocks.findCategory.mockResolvedValue({ id: categoryId, isActive: true });
    mocks.countProducts.mockResolvedValue(0);
    mocks.updateProduct.mockResolvedValue({ id: productId });
    mocks.updateCategory.mockResolvedValue({ id: categoryId, isActive: false });
    mocks.findVariant.mockResolvedValue({
      id: variantId,
      productId,
      sku: "SKU-OLD",
      name: "Existing variant",
      price: "100.00",
      hasWarranty: null,
      warrantyDuration: null,
      warrantyTerms: null,
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
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: productId }])
      .mockResolvedValueOnce([{ id: categoryId, isActive: false }]);

    await expect(
      updateProduct(productId, { categoryId }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("prevents reactivating a product in an inactive category", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: productId }])
      .mockResolvedValueOnce([{ id: categoryId, isActive: false }]);

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
    mocks.queryRaw.mockResolvedValue([{ id: productId, isActive: false }]);

    await expect(setProductVariantActive(variantId, true)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.updateVariant).not.toHaveBeenCalled();
  });
});
