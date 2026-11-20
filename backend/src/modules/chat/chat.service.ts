import {
  ChatConversationStatus,
  ChatEventType,
  ChatSenderType,
  Prisma,
} from "@prisma/client";
import { AppError } from "../../common/errors/AppError";
import prisma from "../../infrastructure/prisma/client";
import type { ChatOwner } from "./chat.types";
import { publishNotificationEvent } from "../notifications/notification-outbox.publisher";

const conversationSelect = {
  id: true,
  status: true,
  lastMessageAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChatConversationSelect;

const messageSelect = {
  id: true,
  senderType: true,
  content: true,
  createdAt: true,
  senderAgent: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ChatMessageSelect;

function ownerWhere(owner: ChatOwner): Prisma.ChatConversationWhereInput {
  return owner.type === "CUSTOMER"
    ? { customerUserId: owner.id }
    : { guestSessionId: owner.id };
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError("Invalid conversation ID", 400);
  }
}

export async function createConversation(owner: ChatOwner) {
  return prisma.chatConversation.create({
    data: {
      ...(owner.type === "CUSTOMER"
        ? { customerUserId: owner.id }
        : { guestSessionId: owner.id }),
      messages: {
        create: {
          senderType: ChatSenderType.SYSTEM,
          content: "Thanks for contacting customer support. How can we help you today?",
        },
      },
    },
    select: conversationSelect,
  });
}

export async function listConversations(
  owner: ChatOwner,
  limit: number,
  cursor?: string,
) {
  const where: Prisma.ChatConversationWhereInput = ownerWhere(owner);

  if (cursor) {
    assertUuid(cursor);
    const cursorConversation = await prisma.chatConversation.findFirst({
      where: { id: cursor, ...ownerWhere(owner) },
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
    take: limit + 1,
    select: conversationSelect,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}

export async function getConversation(owner: ChatOwner, conversationId: string) {
  assertUuid(conversationId);
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, ...ownerWhere(owner) },
    select: conversationSelect,
  });
  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }
  return conversation;
}

export async function listConversationMessages(
  owner: ChatOwner,
  conversationId: string,
  limit: number,
  cursor?: string,
) {
  await getConversation(owner, conversationId);

  let cursorMessage: { id: string; createdAt: Date } | null = null;
  if (cursor) {
    assertUuid(cursor);
    cursorMessage = await prisma.chatMessage.findFirst({
      where: { id: cursor, conversationId },
      select: { id: true, createdAt: true },
    });
    if (!cursorMessage) {
      throw new AppError("Invalid message cursor", 400);
    }
  }

  const where: Prisma.ChatMessageWhereInput = { conversationId };
  if (cursorMessage) {
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
    take: limit + 1,
    select: messageSelect,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return {
    items: page.reverse(),
    nextCursor,
  };
}

/**
 * Keep conversation activity ordered by the newest persisted message.
 *
 * Concurrent message transactions can reach this update in a different order
 * from their message timestamps, so the database must never move the activity
 * timestamp backwards.
 */
export async function updateConversationLastMessageAt(
  tx: Prisma.TransactionClient,
  conversationId: string,
  messageCreatedAt: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "chat_conversations"
    SET "last_message_at" = GREATEST("last_message_at", ${messageCreatedAt})
    WHERE "id" = ${conversationId}::uuid
  `;
}

export async function sendCustomerMessage(
  owner: ChatOwner,
  conversationId: string,
  input: { content: string; clientMessageId: string },
) {
  assertUuid(conversationId);

  const uniqueKey = {
    conversationId_senderType_clientMessageId: {
      conversationId,
      senderType: ChatSenderType.CUSTOMER,
      clientMessageId: input.clientMessageId,
    },
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findFirst({
        where: { id: conversationId, ...ownerWhere(owner) },
        select: { status: true },
      });
      if (!conversation) {
        throw new AppError("Conversation not found", 404);
      }
      if (conversation.status === ChatConversationStatus.CLOSED) {
        throw new AppError("This conversation is closed", 409);
      }

      const existing = await tx.chatMessage.findUnique({
        where: uniqueKey,
        select: messageSelect,
      });
      if (existing) return existing;

      const message = await tx.chatMessage.create({
        data: {
          conversationId,
          senderType: ChatSenderType.CUSTOMER,
          content: input.content,
          clientMessageId: input.clientMessageId,
        },
        select: messageSelect,
      });
      await updateConversationLastMessageAt(
        tx,
        conversationId,
        message.createdAt,
      );
      return message;
    });
  } catch (error) {
    // A concurrent retry can win the unique constraint after our initial
    // lookup. Return that persisted message instead of creating a duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.chatMessage.findUnique({
        where: uniqueKey,
        select: messageSelect,
      });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function requestHumanHandoff(
  owner: ChatOwner,
  conversationId: string,
) {
  assertUuid(conversationId);

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.chatConversation.findFirst({
      where: { id: conversationId, ...ownerWhere(owner) },
      select: { id: true, status: true },
    });
    if (!conversation) {
      throw new AppError("Conversation not found", 404);
    }

    if (conversation.status === ChatConversationStatus.WAITING_FOR_AGENT) {
      return tx.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: conversationSelect,
      });
    }
    if (conversation.status !== ChatConversationStatus.BOT_ACTIVE) {
      throw new AppError("This conversation cannot be handed off in its current state", 409);
    }

    const now = new Date();
    const changed = await tx.chatConversation.updateMany({
      where: {
        id: conversationId,
        status: ChatConversationStatus.BOT_ACTIVE,
      },
      data: {
        status: ChatConversationStatus.WAITING_FOR_AGENT,
        lastMessageAt: now,
      },
    });

    if (changed.count === 0) {
      const latest = await tx.chatConversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: conversationSelect,
      });
      if (latest.status === ChatConversationStatus.WAITING_FOR_AGENT) return latest;
      throw new AppError("This conversation cannot be handed off in its current state", 409);
    }

    await tx.chatEvent.create({
      data: {
        conversationId,
        eventType: ChatEventType.HANDOFF_REQUESTED,
        previousStatus: ChatConversationStatus.BOT_ACTIVE,
        newStatus: ChatConversationStatus.WAITING_FOR_AGENT,
        metadata: { source: "customer" },
      },
    });
    await tx.chatMessage.create({
      data: {
        conversationId,
        senderType: ChatSenderType.SYSTEM,
        content: "Your request is in the customer-care queue. An agent will join as soon as one is available.",
        createdAt: now,
      },
    });

    await publishNotificationEvent(tx, {
      eventType: "chat.handoff_requested",
      aggregateType: "CHAT",
      aggregateId: conversationId,
      payload: {
        conversationId,
        source: "customer",
      },
    });

    return tx.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: conversationSelect,
    });
  });
}
