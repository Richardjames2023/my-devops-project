import { Prisma } from "@prisma/client";
import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import type { StaffOrderListQuery } from "./staff-order.validation";

export async function listStaffOrders(query: StaffOrderListQuery) {
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus
      ? { payments: { some: { status: query.paymentStatus } } }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { orderNumber: { contains: query.search, mode: "insensitive" } },
            { customerName: { contains: query.search, mode: "insensitive" } },
            { customerEmail: { contains: query.search, mode: "insensitive" } },
            { customerPhone: { contains: query.search, mode: "insensitive" } },
            { user: { is: { email: { contains: query.search, mode: "insensitive" } } } },
            { user: { is: { firstName: { contains: query.search, mode: "insensitive" } } } },
            { user: { is: { lastName: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        subtotal: true,
        discountAmount: true,
        deliveryFee: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        items: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            sku: true,
            quantity: true,
            totalPrice: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            provider: true,
            status: true,
            amount: true,
            currency: true,
            createdAt: true,
            paidAt: true,
          },
        },
        fulfillment: {
          select: {
            id: true,
            status: true,
            packages: {
              select: {
                id: true,
                status: true,
                trackingNumber: true,
                delivery: {
                  select: { id: true, status: true, provider: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getStaffOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      inventoryReservations: { orderBy: { createdAt: "asc" } },
      fulfillment: {
        include: {
          packages: {
            orderBy: { createdAt: "asc" },
            include: {
              items: { include: { orderItem: true } },
              delivery: {
                include: {
                  attempts: { orderBy: { attemptedAt: "desc" } },
                  assignedStaff: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                  },
                },
              },
            },
          },
        },
      },
      returnRequests: {
        orderBy: { createdAt: "desc" },
        include: { items: true, evidence: true },
      },
      refunds: {
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
      couponRedemption: true,
    },
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: { entity: "Order", entityId: orderId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      staffAccount: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  return { ...order, auditLogs };
}
