import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn();
  const findUnique = vi.fn();
  const update = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    productVariant: { findUnique, update },
    auditLog: { create: auditCreate },
  };
  return {
    queryRaw,
    findUnique,
    update,
    auditCreate,
    tx,
    transaction: vi.fn(),
  };
});

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: { $transaction: mocks.transaction },
}));

import { updateProductVariantCost } from "../src/modules/products/product-variant.service";

const variantId = "a7e2b6c5-7d8f-8e9a-b0c1-2d3e4f5a6b7c";
const staffId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";

describe("product variant cost management", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.queryRaw.mockResolvedValue([{ id: variantId }]);
    mocks.findUnique.mockResolvedValue({
      id: variantId,
      sku: "SKU-001",
      costPrice: "80.00",
    });
    mocks.update.mockResolvedValue({
      id: variantId,
      sku: "SKU-001",
      costPrice: "95.00",
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("locks the variant, updates its cost, and audits the old and new values", async () => {
    const result = await updateProductVariantCost(
      variantId,
      { costPrice: "95.00" },
      staffId,
    );

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: variantId },
      data: { costPrice: "95.00" },
      select: { id: true, sku: true, costPrice: true },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        staffAccount: { connect: { id: staffId } },
        action: "PRODUCT_VARIANT_COST_UPDATED",
        entity: "ProductVariant",
        entityId: variantId,
        oldValues: { costPrice: "80.00" },
        newValues: { costPrice: "95.00" },
      }),
    });
    expect(result.costPrice).toBe("95.00");
  });

  it("does not create a redundant audit record when the cost is unchanged", async () => {
    mocks.update.mockResolvedValue({
      id: variantId,
      sku: "SKU-001",
      costPrice: "80.00",
    });

    await updateProductVariantCost(
      variantId,
      { costPrice: "80.00" },
      staffId,
    );

    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("supports clearing a cost and records the change", async () => {
    mocks.update.mockResolvedValue({
      id: variantId,
      sku: "SKU-001",
      costPrice: null,
    });

    await updateProductVariantCost(
      variantId,
      { costPrice: null },
      staffId,
    );

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValues: { costPrice: "80.00" },
        newValues: { costPrice: null },
      }),
    });
  });

  it("returns not found without updating or auditing a missing variant", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await expect(
      updateProductVariantCost(variantId, { costPrice: "95.00" }, staffId),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
