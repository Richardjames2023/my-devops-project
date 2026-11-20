import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Server as SocketIOServer } from "socket.io";

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

export function createChatRealtimeServer(
  httpServer: HttpServer,
  allowedOrigins: readonly string[],
): SocketIOServer {
  return new SocketIOServer(httpServer, {
    serveClient: false,
    cors: {
      origin: [...allowedOrigins],
      credentials: true,
      methods: ["GET", "POST"],
    },
    // CORS headers do not protect WebSocket upgrades. Enforce the same
    // allowlist at the Engine.IO request boundary as well.
    allowRequest: (
      request: IncomingMessage,
      callback: (error: string | null, success: boolean) => void,
    ) => {
      const origin = request.headers.origin;
      callback(
        isChatOriginAllowed(origin, allowedOrigins)
          ? null
          : "Origin is not allowed",
        isChatOriginAllowed(origin, allowedOrigins),
      );
    },
    maxHttpBufferSize: 64 * 1024,
  });
}
