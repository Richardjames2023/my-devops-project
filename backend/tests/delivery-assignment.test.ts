import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findDelivery: vi.fn(),
  updateDelivery: vi.fn(),
  findStaff: vi.fn(),
  findManyDeliveries: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    $transaction: mocks.transaction,
    delivery: {
      findMany: mocks.findManyDeliveries,
    },
  },
}));

import {
  assignDelivery,
  listAssignedDeliveries,
  updateDeliveryStatus,
} from "../src/modules/delivery/delivery.service";

const agentId = "c3a8d2e1-3f4b-4a5c-9d6e-7f8a9b0c1d2e";
const otherAgentId = "d4b9e3f2-4a5c-5b6d-8e7f-9a0b1c2d3e4f";
const deliveryId = "e5c0f4a3-5b6d-6c7e-9f8a-0b1c2d3e4f5a";

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    delivery: {
      findUnique: mocks.findDelivery,
      update: mocks.updateDelivery,
    },
    staffAccount: {
      findFirst: mocks.findStaff,
    },
  };
}

describe("delivery staff assignment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transactionClient()),
    );
  });

  it("does not allow an agent to update a delivery assigned to another agent", async () => {
    mocks.findDelivery.mockResolvedValue({
      id: deliveryId,
      packageId: "f6d1a5b4-6c7e-7d8f-a9b0-1c2d3e4f5a6b",
      status: "ASSIGNED",
      assignedStaffAccountId: otherAgentId,
    });

    await expect(
      updateDeliveryStatus(deliveryId, "PICKED_UP", {
        staffAccountId: agentId,
        canManageAllDeliveries: false,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.updateDelivery).not.toHaveBeenCalled();
  });

  it("allows an agent to update their assigned delivery", async () => {
    mocks.findDelivery.mockResolvedValue({
      id: deliveryId,
      packageId: "f6d1a5b4-6c7e-7d8f-a9b0-1c2d3e4f5a6b",
      status: "ASSIGNED",
      assignedStaffAccountId: agentId,
    });
    mocks.updateDelivery.mockResolvedValue({
      id: deliveryId,
      status: "PICKED_UP",
      assignedStaffAccountId: agentId,
    });

    const result = await updateDeliveryStatus(deliveryId, "PICKED_UP", {
      staffAccountId: agentId,
      canManageAllDeliveries: false,
    });

    expect(result.status).toBe("PICKED_UP");
    expect(mocks.updateDelivery).toHaveBeenCalledOnce();
  });

  it("allows a staff member with an additional elevated role to manage deliveries outside their own assignments", async () => {
    mocks.findDelivery.mockResolvedValue({
      id: deliveryId,
      packageId: "f6d1a5b4-6c7e-7d8f-a9b0-1c2d3e4f5a6b",
      status: "ASSIGNED",
      assignedStaffAccountId: otherAgentId,
    });
    mocks.updateDelivery.mockResolvedValue({
      id: deliveryId,
      status: "PICKED_UP",
      assignedStaffAccountId: otherAgentId,
    });

    await expect(
      updateDeliveryStatus(deliveryId, "PICKED_UP", {
        staffAccountId: agentId,
        canManageAllDeliveries: true,
      }),
    ).resolves.toMatchObject({ status: "PICKED_UP" });
  });

  it("only lists deliveries assigned to the requesting staff account", async () => {
    mocks.findManyDeliveries.mockResolvedValue([]);

    await listAssignedDeliveries(agentId);

    expect(mocks.findManyDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedStaffAccountId: agentId },
      }),
    );
  });

  it("only assigns deliveries to active staff members with the DELIVERY_AGENT role", async () => {
    mocks.findDelivery.mockResolvedValue({
      id: deliveryId,
      status: "PENDING",
      assignedStaffAccountId: null,
    });
    mocks.findStaff.mockResolvedValue(null);

    await expect(assignDelivery(deliveryId, agentId)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.updateDelivery).not.toHaveBeenCalled();
  });
});
