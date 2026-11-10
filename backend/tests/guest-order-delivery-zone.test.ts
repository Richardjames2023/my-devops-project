import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    order: { findFirst: mocks.findFirst },
  },
}));

import { getGuestOrder } from "../src/modules/orders/order.service";

describe("guest order delivery-zone snapshot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the delivery-zone name saved on the guest order", async () => {
    const orderId = "8d6c5b4a-3f2e-4d1c-9b8a-7e6f5d4c3b2a";
    const guestAccessToken = "guest-order-access-token";
    mocks.findFirst.mockResolvedValue({
      id: orderId,
      deliveryFee: "350.00",
      deliveryZoneName: "Abuja Metro",
    });

    const order = await getGuestOrder(orderId, guestAccessToken);

    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: orderId,
          guestAccessTokenHash: expect.any(String),
        },
        select: expect.objectContaining({
          deliveryFee: true,
          deliveryZoneName: true,
        }),
      }),
    );
    expect(order).toMatchObject({
      id: orderId,
      deliveryFee: "350.00",
      deliveryZoneName: "Abuja Metro",
    });
  });
});
