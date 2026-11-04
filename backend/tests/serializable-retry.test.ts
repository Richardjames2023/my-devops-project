import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { withSerializableRetry } from "../src/modules/inventory-reconciliation/inventory-reconciliation.service";

describe("Serializable transaction retry", () => {
  it("retries a P2034 conflict and succeeds on the next attempt", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          "Transaction failed due to a write conflict or deadlock.",
          {
            code: "P2034",
            clientVersion: Prisma.prismaVersion.client,
          },
        ),
      )
      .mockResolvedValueOnce("success");

    const result = await withSerializableRetry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry errors other than P2034", async () => {
    const error = new Error("Database connection failed");

    const operation = vi.fn().mockRejectedValue(error);

    await expect(withSerializableRetry(operation)).rejects.toThrow(
      "Database connection failed",
    );

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the maximum number of attempts", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Transaction failed due to a write conflict or deadlock.",
      {
        code: "P2034",
        clientVersion: Prisma.prismaVersion.client,
      },
    );

    const operation = vi.fn().mockRejectedValue(error);

    await expect(withSerializableRetry(operation, 3)).rejects.toThrow(
      "Transaction failed due to a write conflict or deadlock.",
    );

    expect(operation).toHaveBeenCalledTimes(3);
  });
});