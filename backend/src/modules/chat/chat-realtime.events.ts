import type { Server as SocketIOServer } from "socket.io";

const CHAT_ROOM_PREFIX = "chat:conversation:";

type ChatRealtimeTarget = Pick<SocketIOServer, "to">;

type ChatMessagePayload = {
  id: string;
  conversationId: string;
  senderType: string;
  content: string;
  createdAt: Date;
  senderAgent?: {
    id?: string;
    firstName: string;
    lastName: string;
  } | null;
  senderAgentId?: string | null;
};

type ChatConversationStatusPayload = {
  conversationId: string;
  status: string;
  assignedAgentId: string | null;
  assignedAgent?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  closedAt: Date | null;
  updatedAt: Date;
};

let realtimeServer: ChatRealtimeTarget | null = null;

/** Attach the live transport after Socket.IO authentication and room guards are configured. */
export function setChatRealtimeServer(server: ChatRealtimeTarget | null): void {
  realtimeServer = server;
}

function emitToConversation(
  conversationId: string,
  event: string,
  payload: unknown,
): void {
  if (!realtimeServer) return;

  try {
    realtimeServer
      .to(`${CHAT_ROOM_PREFIX}${conversationId}`)
      .emit(event, payload);
  } catch {
    // Realtime delivery is best-effort; committed REST operations remain successful.
  }
}

/** Emit only after the message transaction has committed. */
export function emitChatMessage(message: ChatMessagePayload): void {
  emitToConversation(message.conversationId, "chat:message:new", message);
}

/** Emit a committed conversation state transition to authorized room members. */
export function emitChatConversationStatus(
  payload: ChatConversationStatusPayload,
): void {
  emitToConversation(payload.conversationId, "chat:conversation:status", payload);
}

/** Notify authorized room members when a staff agent claims a conversation. */
export function emitChatConversationAssigned(payload: {
  conversationId: string;
  assignedAgent: {
    id: string;
    firstName: string;
    lastName: string;
  };
}): void {
  emitToConversation(payload.conversationId, "chat:conversation:assigned", payload);
}

export function emitPersistedChatRealtimeEvent(event: {
  id: string;
  conversationId: string;
  sequence: number;
  eventName: string;
  payload: unknown;
  createdAt: Date;
}): void {
  const payload =
    typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : { value: event.payload };

  emitToConversation(event.conversationId, event.eventName, {
    ...payload,
    eventId: event.id,
    sequence: event.sequence,
    eventCreatedAt: event.createdAt,
  });
}
