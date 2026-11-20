import {
  ChatConversationStatus,
  ChatEventType,
  ChatSenderType,
  Prisma,
} from "@prisma/client";
import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";
import { updateConversationLastMessageAt } from "./chat.service";

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

const staffMessageSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  senderAgentId: true,
  content: true,
  clientMessageId: true,
  createdAt: true,
  senderAgent: {
    select: { id: true, firstName: true, lastName: true },
  },
} satisfies Prisma.ChatMessageSelect;

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(`Invalid ${label}`, 400);
  }
}

async function lockStaffConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: ChatConversationStatus;
    assignedAgentId: string | null;
  }>>`
    SELECT
      "id",
      "status",
      "assigned_agent_id" AS "assignedAgentId"
    FROM "chat_conversations"
    WHERE "id" = ${conversationId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

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

export async function getStaffChatConversation(
  conversationId: string,
  input: { limit: number; cursor?: string },
) {
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

  const where: Prisma.ChatMessageWhereInput = { conversationId };
  if (input.cursor) {
    const cursorMessage = await prisma.chatMessage.findFirst({
      where: { id: input.cursor, conversationId },
      select: { id: true, createdAt: true },
    });

    if (!cursorMessage) {
      throw new AppError("Invalid message cursor", 400);
    }

    where.OR = [
      { createdAt: { lt: cursorMessage.createdAt } },
      {
        createdAt: cursorMessage.createdAt,
        id: { lt: cursorMessage.id },
      },
    ];
  }

  const rows = await prisma.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: transcriptMessageSelect,
  });

  const hasMore = rows.length > input.limit;
  const messages = rows.slice(0, input.limit).reverse();

  return {
    ...conversation,
    messages,
    messagePagination: {
      hasMore,
      nextCursor: hasMore ? messages[0]?.id ?? null : null,
    },
  };
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

/**
 * Only the currently assigned agent may reply. Locking the conversation row
 * serializes replies with closure so no message can be committed after close.
 * clientMessageId makes network retries idempotent for the assigned agent.
 */
export async function sendStaffChatMessage(
  conversationId: string,
  staffAccountId: string,
  input: { content: string; clientMessageId: string },
) {
  assertUuid(conversationId, "conversation ID");
  assertUuid(input.clientMessageId, "client message ID");

  return prisma.$transaction(async (tx) => {
    const current = await lockStaffConversation(tx, conversationId);
    if (!current) {
      throw new AppError("Conversation not found", 404);
    }
    if (current.assignedAgentId !== staffAccountId) {
      throw new AppError("Only the assigned agent can reply to this conversation", 403);
    }

    const uniqueKey = {
      conversationId_senderType_clientMessageId: {
        conversationId,
        senderType: ChatSenderType.AGENT,
        clientMessageId: input.clientMessageId,
      },
    };
    const existing = await tx.chatMessage.findUnique({
      where: uniqueKey,
      select: staffMessageSelect,
    });
    if (existing) {
      if (
        existing.senderAgentId !== staffAccountId ||
        existing.content !== input.content
      ) {
        throw new AppError("Client message ID has already been used with a different request", 409);
      }
      return existing;
    }

    if (current.status === ChatConversationStatus.CLOSED) {
      throw new AppError("This conversation is closed", 409);
    }
    if (current.status !== ChatConversationStatus.HUMAN_ACTIVE) {
      throw new AppError("Conversation must be claimed before an agent can reply", 409);
    }

    const message = await tx.chatMessage.create({
      data: {
        conversationId,
        senderType: ChatSenderType.AGENT,
        senderAgentId: staffAccountId,
        content: input.content,
        clientMessageId: input.clientMessageId,
      },
      select: staffMessageSelect,
    });
    await updateConversationLastMessageAt(tx, conversationId, message.createdAt);
    return message;
  });
}

/**
 * Closure is idempotent for the agent who performed it. The row lock ensures
 * that a concurrent reply either commits before closure or is rejected after it.
 */
export async function closeStaffChatConversation(
  conversationId: string,
  staffAccountId: string,
) {
  assertUuid(conversationId, "conversation ID");

  return prisma.$transaction(async (tx) => {
    const current = await lockStaffConversation(tx, conversationId);
    if (!current) {
      throw new AppError("Conversation not found", 404);
    }
    if (current.assignedAgentId !== staffAccountId) {
      throw new AppError("Only the assigned agent can close this conversation", 403);
    }

    if (current.status === ChatConversationStatus.CLOSED) {
      const closeEvent = await tx.chatEvent.findFirst({
        where: {
          conversationId,
          eventType: ChatEventType.CONVERSATION_CLOSED,
          actorAgentId: staffAccountId,
        },
        select: { id: true },
      });
      if (closeEvent) {
        return tx.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
          select: inboxConversationSelect,
        });
      }
      throw new AppError("Conversation has already been closed", 409);
    }

    if (current.status !== ChatConversationStatus.HUMAN_ACTIVE) {
      throw new AppError("Only an active human conversation can be closed", 409);
    }

    const now = new Date();
    const changed = await tx.chatConversation.updateMany({
      where: {
        id: conversationId,
        status: ChatConversationStatus.HUMAN_ACTIVE,
        assignedAgentId: staffAccountId,
      },
      data: {
        status: ChatConversationStatus.CLOSED,
        closedAt: now,
      },
    });
    if (changed.count !== 1) {
      throw new AppError("Conversation could not be closed in its current state", 409);
    }

    await tx.chatEvent.create({
      data: {
        conversationId,
        eventType: ChatEventType.CONVERSATION_CLOSED,
        previousStatus: ChatConversationStatus.HUMAN_ACTIVE,
        newStatus: ChatConversationStatus.CLOSED,
        actorAgentId: staffAccountId,
        metadata: { source: "staff_close" },
        createdAt: now,
      },
    });

    return tx.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: inboxConversationSelect,
    });
  });
}
