import {
  ChatConversationStatus,
  ChatEventType,
  Prisma,
} from "@prisma/client";
import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";

const inboxConversationSelect = {
  id: true,
  status: true,
  customerUserId: true,
  guestSessionId: true,
  assignedAgentId: true,
  lastMessageAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedAgent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  messages: {
    take: 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      senderType: true,
      content: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ChatConversationSelect;

const transcriptMessageSelect = {
  id: true,
  senderType: true,
  content: true,
  createdAt: true,
  senderAgent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ChatMessageSelect;

export async function listStaffChatConversations(input: {
  status: ChatConversationStatus;
  limit: number;
  cursor?: string;
}) {
  const where: Prisma.ChatConversationWhereInput = {
    status: input.status,
  };

  if (input.cursor) {
    const cursorConversation = await prisma.chatConversation.findFirst({
      where: { id: input.cursor, status: input.status },
      select: { id: true, lastMessageAt: true },
    });

    if (!cursorConversation) {
      throw new AppError("Invalid conversation cursor", 400);
    }

    where.OR = [
      { lastMessageAt: { lt: cursorConversation.lastMessageAt } },
      {
        lastMessageAt: cursorConversation.lastMessageAt,
        id: { lt: cursorConversation.id },
      },
    ];
  }

  const rows = await prisma.chatConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: inboxConversationSelect,
  });

  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}

export async function getStaffChatConversation(conversationId: string) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      status: true,
      customerUserId: true,
      guestSessionId: true,
      assignedAgentId: true,
      lastMessageAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      assignedAgent: {
        select: { id: true, firstName: true, lastName: true },
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventType: true,
          previousStatus: true,
          newStatus: true,
          metadata: true,
          createdAt: true,
          actorAgent: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });

  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: transcriptMessageSelect,
  });

  return { ...conversation, messages };
}

/**
 * A claim is a single compare-and-set transition. Only one concurrent agent
 * can move a waiting conversation into HUMAN_ACTIVE and become its assignee.
 */
export async function claimStaffChatConversation(
  conversationId: string,
  staffAccountId: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.chatConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, status: true, assignedAgentId: true },
    });

    if (!current) {
      throw new AppError("Conversation not found", 404);
    }

    if (
      current.status === ChatConversationStatus.HUMAN_ACTIVE &&
      current.assignedAgentId === staffAccountId
    ) {
      return tx.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: inboxConversationSelect,
      });
    }

    if (
      current.status !== ChatConversationStatus.WAITING_FOR_AGENT ||
      current.assignedAgentId !== null
    ) {
      throw new AppError("Conversation is no longer available to claim", 409);
    }

    const claimed = await tx.chatConversation.updateMany({
      where: {
        id: conversationId,
        status: ChatConversationStatus.WAITING_FOR_AGENT,
        assignedAgentId: null,
      },
      data: {
        status: ChatConversationStatus.HUMAN_ACTIVE,
        assignedAgentId: staffAccountId,
      },
    });

    if (claimed.count !== 1) {
      const latest = await tx.chatConversation.findUnique({
        where: { id: conversationId },
        select: { status: true, assignedAgentId: true },
      });

      if (
        latest?.status === ChatConversationStatus.HUMAN_ACTIVE &&
        latest.assignedAgentId === staffAccountId
      ) {
        return tx.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
          select: inboxConversationSelect,
        });
      }

      throw new AppError("Conversation is no longer available to claim", 409);
    }

    await tx.chatEvent.create({
      data: {
        conversationId,
        eventType: ChatEventType.AGENT_ASSIGNED,
        previousStatus: ChatConversationStatus.WAITING_FOR_AGENT,
        newStatus: ChatConversationStatus.HUMAN_ACTIVE,
        actorAgentId: staffAccountId,
        metadata: { source: "staff_claim" },
      },
    });

    return tx.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: inboxConversationSelect,
    });
  });
}
