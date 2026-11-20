import jwt from "jsonwebtoken";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import prisma from "../../infrastructure/prisma/client";
import { JWT_ACCESS_SECRET } from "../../config/auth";
import { getValidGuestSession } from "../guest-session/guest-session.service";
import { GUEST_SESSION_COOKIE } from "../guest-session/guest-session.cookie";

/**
 * Keep the realtime transport's browser-origin policy aligned with Express.
 * Requests without an Origin header are server-to-server/native clients and
 * remain supported; browser origins must match the configured allowlist.
 */
export function isChatOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  return origin === undefined || allowedOrigins.includes(origin);
}

export type ChatSocketIdentity =
  | { type: "CUSTOMER"; id: string; sessionVersion: number; expiresAt: number }
  | { type: "STAFF"; id: string; expiresAt: number }
  | { type: "GUEST"; id: string; expiresAt: Date };

type ChatSocket = Socket & {
  data: Socket["data"] & { chatIdentity?: ChatSocketIdentity };
};

const CHAT_ROOM_PREFIX = "chat:conversation:";
const MAX_ROOMS_PER_SOCKET = 50;
const IDENTITY_RECHECK_INTERVAL_MS = 30_000;

export function getChatConversationRoomName(conversationId: string): string {
  return `${CHAT_ROOM_PREFIX}${conversationId}`;
}

function readBearerToken(socket: Socket): string | null {
  const header = socket.handshake.headers.authorization;
  const supplied = socket.handshake.auth?.accessToken;

  if (header !== undefined && supplied !== undefined) {
    throw new Error("Ambiguous credentials");
  }

  if (supplied !== undefined) {
    if (typeof supplied !== "string" || supplied.length === 0) {
      throw new Error("Invalid access token");
    }
    return supplied;
  }

  if (header === undefined) return null;
  if (typeof header !== "string") throw new Error("Invalid authorization header");

  const match = /^Bearer ([^\\s]+)$/.exec(header);
  if (!match?.[1]) throw new Error("Invalid authorization header");
  return match[1];
}

function readGuestSessionCookie(socket: Socket): string | null {
  const header = socket.handshake.headers.cookie;
  if (!header) return null;

  const values = header.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${GUEST_SESSION_COOKIE}=`));
  if (values.length !== 1) return null;

  try {
    const token = decodeURIComponent(values[0]!.slice(GUEST_SESSION_COOKIE.length + 1));
    return /^[a-f0-9]{64}$/i.test(token) ? token : null;
  } catch {
    return null;
  }
}

function verifyAccessToken(token: string): {
  id: string;
  identityType: "CUSTOMER" | "STAFF";
  sessionVersion: number;
  expiresAt: number;
} {
  const payload = jwt.verify(token, JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  });

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    (payload.identityType !== undefined &&
      payload.identityType !== "CUSTOMER" &&
      payload.identityType !== "STAFF") ||
    !Array.isArray(payload.roles) ||
    !payload.roles.every((role: unknown) => typeof role === "string") ||
    !Array.isArray(payload.permissions) ||
    !payload.permissions.every((permission: unknown) => typeof permission === "string") ||
    typeof payload.iat !== "number" ||
    !Number.isFinite(payload.iat) ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp) ||
    (payload.sessionVersion !== undefined &&
      (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion < 0))
  ) {
    throw new Error("Invalid access token");
  }

  return {
    id: payload.sub,
    // Match the existing HTTP authentication middleware's legacy-token rule.
    identityType: payload.identityType ?? "CUSTOMER",
    sessionVersion: typeof payload.sessionVersion === "number" ? payload.sessionVersion : 0,
    expiresAt: payload.exp,
  };
}

async function staffHasChatReadPermission(staffId: string): Promise<boolean> {
  const staff = await prisma.staffAccount.findUnique({
    where: { id: staffId },
    select: {
      status: true,
      roles: {
        select: {
          role: {
            select: {
              permissions: {
                select: { permission: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  return Boolean(
    staff?.status === "ACTIVE" &&
    staff.roles.some(({ role }) =>
      role.permissions.some(({ permission }) => permission.name === "chat.read"),
    ),
  );
}

async function isIdentityCurrent(identity: ChatSocketIdentity): Promise<boolean> {
  if (identity.type === "CUSTOMER") {
    const user = await prisma.user.findUnique({
      where: { id: identity.id },
      select: {
        isActive: true,
        emailVerified: true,
        sessionVersion: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    return Boolean(
      user?.isActive &&
      user.emailVerified &&
      user.sessionVersion === identity.sessionVersion &&
      user.userRoles.some(({ role }) => role.name === "CUSTOMER"),
    );
  }

  if (identity.type === "GUEST") {
    const session = await prisma.guestSession.findFirst({
      where: {
        id: identity.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    return Boolean(session);
  }

  return staffHasChatReadPermission(identity.id);
}

async function resolveSocketIdentity(socket: Socket): Promise<ChatSocketIdentity> {
  const token = readBearerToken(socket);
  if (token) {
    const claims = verifyAccessToken(token);

    if (claims.identityType === "CUSTOMER") {
      const user = await prisma.user.findUnique({
        where: { id: claims.id },
        select: {
          isActive: true,
          emailVerified: true,
          sessionVersion: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      });

      if (
        !user?.isActive ||
        !user.emailVerified ||
        user.sessionVersion !== claims.sessionVersion ||
        !user.userRoles.some(({ role }) => role.name === "CUSTOMER")
      ) {
        throw new Error("Customer identity is inactive or unavailable");
      }

      return {
        type: "CUSTOMER",
        id: claims.id,
        sessionVersion: claims.sessionVersion,
        expiresAt: claims.expiresAt,
      };
    }

    if (!(await staffHasChatReadPermission(claims.id))) {
      throw new Error("Staff chat access is unavailable");
    }
    return { type: "STAFF", id: claims.id, expiresAt: claims.expiresAt };
  }

  const guestToken = readGuestSessionCookie(socket);
  if (!guestToken) throw new Error("Chat authentication required");

  const session = await getValidGuestSession(guestToken);
  if (!session) throw new Error("Guest session is invalid or expired");

  return { type: "GUEST", id: session.id, expiresAt: session.expiresAt };
}

async function canJoinConversation(
  identity: ChatSocketIdentity,
  conversationId: string,
): Promise<boolean> {
  if (!(await isIdentityCurrent(identity))) return false;

  if (identity.type === "CUSTOMER") {
    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, customerUserId: identity.id },
      select: { id: true },
    });
    return Boolean(conversation);
  }

  if (identity.type === "GUEST") {
    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, guestSessionId: identity.id },
      select: { id: true },
    });
    return Boolean(conversation);
  }

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  return Boolean(conversation);
}

function acknowledge(
  callback: unknown,
  result: { ok: boolean; error?: string; conversationId?: string },
): void {
  if (typeof callback === "function") {
    (callback as (value: typeof result) => void)(result);
  }
}

export function createChatRealtimeServer(
  httpServer: HttpServer,
  allowedOrigins: readonly string[],
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    serveClient: false,
    cors: {
      origin: [...allowedOrigins],
      credentials: true,
      methods: ["GET", "POST"],
    },
    // CORS headers do not protect WebSocket upgrades. Enforce the same
    // allowlist at the Engine.IO request boundary as well.
    allowRequest: (request, callback) => {
      const allowed = isChatOriginAllowed(request.headers.origin, allowedOrigins);
      callback(allowed ? null : "Origin is not allowed", allowed);
    },
    maxHttpBufferSize: 64 * 1024,
  });

  io.use((socket, next) => {
    void resolveSocketIdentity(socket)
      .then((identity) => {
        (socket as ChatSocket).data.chatIdentity = identity;
        next();
      })
      .catch(() => next(new Error("Unauthorized")));
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as ChatSocket;
    const identity = socket.data.chatIdentity;
    if (!identity) {
      socket.disconnect(true);
      return;
    }

    const expiryDelay = identity.expiresAt instanceof Date
      ? identity.expiresAt.getTime() - Date.now()
      : identity.expiresAt * 1000 - Date.now();
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, expiryDelay));

    let identityCheckRunning = false;
    const identityTimer = setInterval(() => {
      if (identityCheckRunning) return;
      identityCheckRunning = true;
      void isIdentityCurrent(identity)
        .then((valid) => {
          if (!valid) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true))
        .finally(() => { identityCheckRunning = false; });
    }, IDENTITY_RECHECK_INTERVAL_MS);

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      clearInterval(identityTimer);
    });

    socket.on("chat:conversation:join", (payload: unknown, callback?: unknown) => {
      void (async () => {
        const conversationId =
          typeof payload === "object" && payload !== null && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).conversationId
            : undefined;

        if (
          typeof conversationId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
        ) {
          acknowledge(callback, { ok: false, error: "Invalid conversation ID" });
          return;
        }

        const room = getChatConversationRoomName(conversationId);
        const joinedRoomCount = [...socket.rooms].filter((name) =>
          name.startsWith(CHAT_ROOM_PREFIX),
        ).length;
        if (!socket.rooms.has(room) && joinedRoomCount >= MAX_ROOMS_PER_SOCKET) {
          acknowledge(callback, { ok: false, error: "Too many active conversations" });
          return;
        }

        if (!(await canJoinConversation(identity, conversationId))) {
          acknowledge(callback, { ok: false, error: "Conversation access denied" });
          return;
        }

        await socket.join(room);
        acknowledge(callback, { ok: true, conversationId });
      })().catch(() => {
        acknowledge(callback, { ok: false, error: "Unable to join conversation" });
      });
    });
  });

  return io;
}
