import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  updateTask: vi.fn(),
  deleteManyTask: vi.fn(),
  findTask: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    $transaction: mocks.transaction,
    cloudinaryCleanupTask: {
      deleteMany: mocks.deleteManyTask,
      findUnique: mocks.findTask,
      updateMany: mocks.updateTask,
    },
  },
}));

vi.mock("../src/config/cloudinary", () => ({
  getCloudinary: () => ({
    uploader: { destroy: mocks.destroy },
  }),
}));

import { processCloudinaryCleanupBatch } from "../src/infrastructure/cloudinary/cloudinary-cleanup";

describe("Cloudinary cleanup worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: mocks.queryRaw,
        cloudinaryCleanupTask: { update: vi.fn() },
      }),
    );
    mocks.destroy.mockResolvedValue({ result: "ok" });
    mocks.deleteManyTask.mockResolvedValue({ count: 1 });
    mocks.findTask.mockResolvedValue({ attempts: 0 });
    mocks.updateTask.mockResolvedValue({ count: 1 });
  });

  it("deletes a queued asset and removes its task", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "task-1", publicId: "products/p/front" }]);

    await expect(processCloudinaryCleanupBatch(1)).resolves.toBe(1);

    expect(mocks.destroy).toHaveBeenCalledWith("products/p/front", expect.objectContaining({
      resource_type: "image",
      type: "upload",
    }));
    expect(mocks.deleteManyTask).toHaveBeenCalledWith({
      where: { id: "task-1", lockToken: expect.any(String), status: "PROCESSING" },
    });
  });

  it("treats an already missing Cloudinary asset as successfully cleaned", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "task-2", publicId: "products/p/missing" }]);
    mocks.destroy.mockResolvedValueOnce({ result: "not found" });

    await expect(processCloudinaryCleanupBatch(1)).resolves.toBe(1);
    expect(mocks.deleteManyTask).toHaveBeenCalledOnce();
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("reschedules a failed deletion with an increased attempt count", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "task-3", publicId: "products/p/retry" }]);
    mocks.destroy.mockRejectedValueOnce(new Error("Cloudinary unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processCloudinaryCleanupBatch(1)).resolves.toBe(1);

    expect(mocks.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-3", lockToken: expect.any(String), status: "PROCESSING" },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        lockedAt: null,
        lockToken: null,
        lastError: "Cloudinary unavailable",
      }),
    }));
    errorSpy.mockRestore();
  });

  it("stops when there are no pending or stale tasks", async () => {
    await expect(processCloudinaryCleanupBatch(5)).resolves.toBe(0);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});
