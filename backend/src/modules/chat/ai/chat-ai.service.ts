
import { randomUUID } from "node:crypto";
import {
  ChatAiGenerationStatus,
  ChatConversationStatus,
  ChatEventType,
  ChatSenderType,
  Prisma,
} from "@prisma/client";
import { env } from "../../../config/env";
import prisma from "../../../infrastructure/prisma/client";
import type { ChatOwner } from "../chat.types";
import { createChatAiProvider } from "./chat-ai.provider.factory";
import { loadCustomerSupportKnowledgeBase } from "./customer-support-knowledge-base";
import { publishNotificationEvent } from "../../notifications/notification-outbox.publisher";
import type { ChatAiHistoryMessage } from "./chat-ai.types";

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 3;

export type ChatAiAutomationStatus =
  | "NOT_CONFIGURED"
  | "PROCESSING"
  | "GENERATED"
  | "HANDOFF_RECOMMENDED"
  | "SKIPPED"
  | "UNAVAILABLE";

export interface ChatAiAutomationResult {
  status: ChatAiAutomationStatus;
  botMessage?: {
    id: string;
    senderType: "BOT";
    content: string;
    createdAt: Date;
  };
}

export interface GenerateChatAiReplyInput {
  owner: ChatOwner;
  conversationId: string;
  customerMessageId: string;
}

interface ClaimedGeneration {
  id: string;
  leaseToken: string;
  attemptCount: number;
}

interface LockedConversation {
  status: ChatConversationStatus;
}

interface LockedGeneration {
  status: ChatAiGenerationStatus;
  leaseToken: string | null;
  leaseValid: boolean;
}

type BotMessage = {
  id: string;
  senderType: ChatSenderType;
  content: string;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

const ownerWhere = (
  owner: ChatOwner,
): Prisma.ChatConversationWhereInput =>
  owner.type === "CUSTOMER"
    ? { customerUserId: owner.id }
    : { guestSessionId: owner.id };

const botMessageSelect = {
  id: true,
  senderType: true,
  content: true,
  createdAt: true,
  metadata: true,
} satisfies Prisma.ChatMessageSelect;

function toBotMessage(message: BotMessage) {
  return {
    id: message.id,
    senderType: "BOT" as const,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isHandoffRecommended(message: BotMessage): boolean {
  if (!isJsonObject(message.metadata)) {
    return false;
  }

  const aiMetadata = message.metadata.ai;

  if (!isJsonObject(aiMetadata)) {
    return false;
  }

  return aiMetadata.handoffRecommended === true;
}

function toAutomationResult(
  message: BotMessage,
): ChatAiAutomationResult {
  return {
    status: isHandoffRecommended(message)
      ? "HANDOFF_RECOMMENDED"
      : "GENERATED",
    botMessage: toBotMessage(message),
  };
}

async function findCompletedReply(
  conversationId: string,
  customerMessageId: string,
): Promise<ChatAiAutomationResult | null> {
  const generation = await prisma.chatAiGeneration.findUnique({
    where: { customerMessageId },
    select: { status: true },
  });

  if (generation?.status !== ChatAiGenerationStatus.COMPLETED) {
    return null;
  }

  const botMessage = await prisma.chatMessage.findUnique({
    where: {
      conversationId_senderType_clientMessageId: {
        conversationId,
        senderType: ChatSenderType.BOT,
        clientMessageId: customerMessageId,
      },
    },
    select: botMessageSelect,
  });

  if (!botMessage) {
    return { status: "UNAVAILABLE" };
  }

  return toAutomationResult(botMessage);
}

/**
 * Atomically claims a generation.
 *
 * A generation can only be claimed when:
 * - It does not already exist.
 * - Its previous attempt failed.
 * - Its previous processing lease expired.
 *
 * The attempt limit is enforced by PostgreSQL.
 */
async function claimGeneration(
  customerMessageId: string,
  leaseToken: string,
): Promise<ClaimedGeneration | null> {
  const rows = await prisma.$queryRaw<ClaimedGeneration[]>`
    INSERT INTO "chat_ai_generations" (
      "id",
      "customer_message_id",
      "status",
      "lease_token",
      "lease_expires_at",
      "attempt_count",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${customerMessageId}::uuid,
      'PROCESSING'::"ChatAiGenerationStatus",
      ${leaseToken}::uuid,
      NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
      1,
      NOW(),
      NOW()
    )
    ON CONFLICT ("customer_message_id")
    DO UPDATE SET
      "status" = 'PROCESSING'::"ChatAiGenerationStatus",
      "lease_token" = EXCLUDED."lease_token",
      "lease_expires_at" = EXCLUDED."lease_expires_at",
      "attempt_count" =
        "chat_ai_generations"."attempt_count" + 1,
      "failure_code" = NULL,
      "updated_at" = NOW()
    WHERE
      (
        "chat_ai_generations"."status" =
          'FAILED'::"ChatAiGenerationStatus"
        OR (
          "chat_ai_generations"."status" =
            'PROCESSING'::"ChatAiGenerationStatus"
          AND "chat_ai_generations"."lease_expires_at" <= NOW()
        )
      )
      AND "chat_ai_generations"."attempt_count" < ${MAX_ATTEMPTS}
    RETURNING
      "id"::text AS "id",
      "lease_token"::text AS "leaseToken",
      "attempt_count" AS "attemptCount"
  `;

  return rows[0] ?? null;
}

async function getUnavailableOrProcessingResult(
  conversationId: string,
  customerMessageId: string,
): Promise<ChatAiAutomationResult> {
  const existing = await prisma.chatAiGeneration.findUnique({
    where: { customerMessageId },
    select: {
      status: true,
      attemptCount: true,
      leaseExpiresAt: true,
    },
  });

  if (!existing) {
    return { status: "UNAVAILABLE" };
  }

  if (existing.status === ChatAiGenerationStatus.COMPLETED) {
    return (
      (await findCompletedReply(
        conversationId,
        customerMessageId,
      )) ?? { status: "UNAVAILABLE" }
    );
  }

  const now = new Date();

  if (
    existing.status === ChatAiGenerationStatus.PROCESSING &&
    existing.leaseExpiresAt &&
    existing.leaseExpiresAt > now
  ) {
    return { status: "PROCESSING" };
  }

  if (
    existing.status === ChatAiGenerationStatus.PROCESSING &&
    (
      !existing.leaseExpiresAt ||
      existing.leaseExpiresAt <= now
    ) &&
    existing.attemptCount >= MAX_ATTEMPTS
  ) {
    await prisma.chatAiGeneration.updateMany({
      where: {
        customerMessageId,
        status: ChatAiGenerationStatus.PROCESSING,
        attemptCount: { gte: MAX_ATTEMPTS },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: ChatAiGenerationStatus.FAILED,
        leaseToken: null,
        leaseExpiresAt: null,
        failureCode: "MAX_ATTEMPTS_EXCEEDED",
      },
    });
  }

  return { status: "UNAVAILABLE" };
}

async function markGenerationFailed(
  customerMessageId: string,
  leaseToken: string,
  failureCode: string,
): Promise<void> {
  await prisma.chatAiGeneration.updateMany({
    where: {
      customerMessageId,
      status: ChatAiGenerationStatus.PROCESSING,
      leaseToken,
    },
    data: {
      status: ChatAiGenerationStatus.FAILED,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode,
    },
  });
}

async function getConversationHistory(
  conversationId: string,
  customerMessageId: string,
): Promise<ChatAiHistoryMessage[]> {
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      id: { not: customerMessageId },
      senderType: {
        in: [
          ChatSenderType.CUSTOMER,
          ChatSenderType.BOT,
        ],
      },
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: env.CHAT_AI_MAX_HISTORY_MESSAGES,
    select: {
      senderType: true,
      content: true,
    },
  });

  return messages.reverse().map((message) => ({
    role: message.senderType as "CUSTOMER" | "BOT",
    content: message.content,
  }));
}

async function persistGeneratedReply(input: {
  conversationId: string;
  customerMessageId: string;
  leaseToken: string;
  reply: string;
  providerName: string;
  handoffRecommended: boolean;
  handoffReason: string | null;
}): Promise<ChatAiAutomationResult> {
  return prisma.$transaction(async (tx) => {
    /*
     * Lock the conversation first.
     *
     * This serializes bot-message persistence against a concurrent
     * human handoff that changes the conversation status.
     */
    const conversations = await tx.$queryRaw<
      LockedConversation[]
    >`
      SELECT "status"
      FROM "chat_conversations"
      WHERE "id" = ${input.conversationId}::uuid
      FOR UPDATE
    `;

    const conversation = conversations[0];

    if (!conversation) {
      return { status: "UNAVAILABLE" };
    }

    /*
     * Lock the generation row and verify:
     * - It is still processing.
     * - This worker still owns the lease.
     * - The lease has not expired.
     */
    const generations = await tx.$queryRaw<
      LockedGeneration[]
    >`
      SELECT
        "status",
        "lease_token"::text AS "leaseToken",
        ("lease_expires_at" > NOW()) AS "leaseValid"
      FROM "chat_ai_generations"
      WHERE "customer_message_id" = ${input.customerMessageId}::uuid
      FOR UPDATE
    `;

    const generation = generations[0];

    if (!generation) {
      return { status: "UNAVAILABLE" };
    }

    if (
      generation.status === ChatAiGenerationStatus.COMPLETED
    ) {
      const existing = await tx.chatMessage.findUnique({
        where: {
          conversationId_senderType_clientMessageId: {
            conversationId: input.conversationId,
            senderType: ChatSenderType.BOT,
            clientMessageId: input.customerMessageId,
          },
        },
        select: botMessageSelect,
      });

      return existing
        ? toAutomationResult(existing)
        : { status: "UNAVAILABLE" };
    }

    if (
      generation.status !== ChatAiGenerationStatus.PROCESSING ||
      generation.leaseToken !== input.leaseToken ||
      !generation.leaseValid
    ) {
      return { status: "UNAVAILABLE" };
    }

    /*
     * A handoff that commits before this transaction obtains
     * the conversation lock prevents the bot reply from being saved.
     */
    if (
      conversation.status !== ChatConversationStatus.BOT_ACTIVE
    ) {
      await tx.chatAiGeneration.updateMany({
        where: {
          customerMessageId: input.customerMessageId,
          status: ChatAiGenerationStatus.PROCESSING,
          leaseToken: input.leaseToken,
        },
        data: {
          status: ChatAiGenerationStatus.FAILED,
          leaseToken: null,
          leaseExpiresAt: null,
          failureCode: "CONVERSATION_NOT_BOT_ACTIVE",
        },
      });

      return { status: "UNAVAILABLE" };
    }

    /*
     * The customer message ID is the bot-message idempotency key.
     */
    const botMessage = await tx.chatMessage.create({
      data: {
        conversationId: input.conversationId,
        senderType: ChatSenderType.BOT,
        content: input.reply,
        clientMessageId: input.customerMessageId,
        metadata: {
          ai: {
            provider: input.providerName,
            handoffRecommended: input.handoffRecommended,
            handoffReason: input.handoffReason,
          },
        },
      },
      select: botMessageSelect,
    });

    let lastMessageAt = botMessage.createdAt;

    if (input.handoffRecommended) {
      await tx.chatEvent.create({
        data: {
          conversationId: input.conversationId,
          eventType: ChatEventType.HANDOFF_REQUESTED,
          previousStatus: ChatConversationStatus.BOT_ACTIVE,
          newStatus: ChatConversationStatus.WAITING_FOR_AGENT,
          metadata: {
            source: "ai",
            reason: input.handoffReason,
          },
        },
      });

      const handoffMessage = await tx.chatMessage.create({
        data: {
          conversationId: input.conversationId,
          senderType: ChatSenderType.SYSTEM,
          content:
            "Your request has been referred to customer care. An agent will join as soon as one is available.",
        },
        select: { createdAt: true },
      });

      lastMessageAt = handoffMessage.createdAt;

      await tx.chatConversation.update({
        where: { id: input.conversationId },
        data: {
          status: ChatConversationStatus.WAITING_FOR_AGENT,
        },
      });

      await publishNotificationEvent(tx, {
        eventType: "chat.handoff_requested",
        aggregateType: "CHAT",
        aggregateId: input.conversationId,
        payload: {
          conversationId: input.conversationId,
          source: "ai",
          reason: input.handoffReason,
        },
      });
    }

    const completed = await tx.chatAiGeneration.updateMany({
      where: {
        customerMessageId: input.customerMessageId,
        status: ChatAiGenerationStatus.PROCESSING,
        leaseToken: input.leaseToken,
      },
      data: {
        status: ChatAiGenerationStatus.COMPLETED,
        leaseToken: null,
        leaseExpiresAt: null,
        failureCode: null,
      },
    });

    if (completed.count !== 1) {
      throw new Error("AI generation lease was lost during persistence");
    }

    await tx.chatConversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt,
      },
    });

    return {
      status: input.handoffRecommended
        ? "HANDOFF_RECOMMENDED"
        : "GENERATED",
      botMessage: toBotMessage(botMessage),
    };
  });
}

export async function generateChatAiReply(
  input: GenerateChatAiReplyInput,
): Promise<ChatAiAutomationResult> {
  /*
   * Both gates must be enabled.
   * AI remains unavailable by default.
   */
  if (
    !env.CHAT_AI_ENABLED ||
    !env.CHAT_AI_KNOWLEDGE_BASE_APPROVED
  ) {
    return { status: "NOT_CONFIGURED" };
  }

  /*
   * Verify conversation ownership before accessing its messages.
   */
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id: input.conversationId,
      ...ownerWhere(input.owner),
    },
    select: {
      status: true,
    },
  });

  if (!conversation) {
    return { status: "UNAVAILABLE" };
  }

  if (
    conversation.status !== ChatConversationStatus.BOT_ACTIVE
  ) {
    return { status: "SKIPPED" };
  }

  /*
   * Confirm the supplied message belongs to this conversation
   * and was actually sent by the customer.
   */
  const customerMessage = await prisma.chatMessage.findFirst({
    where: {
      id: input.customerMessageId,
      conversationId: input.conversationId,
      senderType: ChatSenderType.CUSTOMER,
    },
    select: {
      id: true,
      content: true,
    },
  });

  if (!customerMessage) {
    return { status: "UNAVAILABLE" };
  }

  /*
   * Return an already-completed reply without calling Gemini again.
   */
  const completed = await findCompletedReply(
    input.conversationId,
    input.customerMessageId,
  );

  if (completed) {
    return completed;
  }

  /*
   * Load the approved knowledge base.
   * Never send draft or invalid content to Gemini.
   */
  let knowledgeBase;

  try {
    knowledgeBase = await loadCustomerSupportKnowledgeBase();
  } catch {
    return { status: "UNAVAILABLE" };
  }

  if (
    !knowledgeBase.approved ||
    knowledgeBase.status !== "Approved" ||
    !knowledgeBase.content.trim()
  ) {
    return { status: "NOT_CONFIGURED" };
  }

  /*
   * Claim the generation using a unique lease token.
   */
  const leaseToken = randomUUID();

  let claim: ClaimedGeneration | null;

  try {
    claim = await claimGeneration(
      input.customerMessageId,
      leaseToken,
    );
  } catch {
    return { status: "UNAVAILABLE" };
  }

  if (!claim) {
    return getUnavailableOrProcessingResult(
      input.conversationId,
      input.customerMessageId,
    );
  }

  try {
    const provider = createChatAiProvider();

    if (!provider) {
      await markGenerationFailed(
        input.customerMessageId,
        leaseToken,
        "PROVIDER_NOT_CONFIGURED",
      );

      return { status: "NOT_CONFIGURED" };
    }

    const history = await getConversationHistory(
      input.conversationId,
      input.customerMessageId,
    );

    /*
     * Gemini runs outside database transactions.
     */
    const generated = await provider.generateReply({
      message: customerMessage.content,
      history,
      knowledgeContext: knowledgeBase.content,
    });

    /*
     * Persistence rechecks conversation status, lease token,
     * and lease expiry under database row locks.
     */
    return await persistGeneratedReply({
      conversationId: input.conversationId,
      customerMessageId: input.customerMessageId,
      leaseToken,
      reply: generated.reply,
      providerName: provider.name,
      handoffRecommended: generated.handoff.recommended,
      handoffReason: generated.handoff.reason,
    });
  } catch {
    /*
     * Only the current lease holder can mark this generation failed.
     * A stale worker cannot overwrite a newer worker's state.
     */
    await markGenerationFailed(
      input.customerMessageId,
      leaseToken,
      "AI_GENERATION_FAILED",
    );

    return { status: "UNAVAILABLE" };
  }
}
