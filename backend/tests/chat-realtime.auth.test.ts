import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  userFindUnique: vi.fn(),
  staffFindUnique: vi.fn(),
  guestSessionFindFirst: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationFindUnique: vi.fn(),
  getValidGuestSession: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: mocks.verify },
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    staffAccount: { findUnique: mocks.staffFindUnique },
    guestSession: { findFirst: mocks.guestSessionFindFirst },
    chatConversation: {
      findFirst: mocks.conversationFindFirst,
      findUnique: mocks.conversationFindUnique,
    },
  },
}));

vi.mock("../src/modules/guest-session/guest-session.service", () => ({
  getValidGuestSession: mocks.getValidGuestSession,
}));

import {
  canJoinConversation,
  isChatOriginAllowed,
  resolveChatSocketIdentity,
} from "../src/modules/chat/chat-realtime.server";

const CUSTOMER_ID = "c4a7bba8-78bb-4c40-8b1b-4cb35df50e11";
const STAFF_ID = "a4a7bba8-78bb-4c40-8b1b-4cb35df50e11";
const GUEST_SESSION_ID = "b4a7bba8-78bb-4c40-8b1b-4cb35df50e11";
const CONVERSATION_ID = "d4a7bba8-78bb-4c40-8b1b-4cb35df50e11";

function makeSocket(input: {
  accessToken?: string;
  authorization?: string;
  cookie?: string;
} = {}): Socket {
  return {
    handshake: {
      auth: input.accessToken ? { accessToken: input.accessToken } : {},
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
    },
  } as unknown as Socket;
}

describe("chat realtime origin policy", () => {
  const allowedOrigins = [
    "http://localhost:3000",
    "https://store.example.com",
  ];

  it("allows configured browser origins", () => {
    expect(isChatOriginAllowed("http://localhost:3000", allowedOrigins)).toBe(true);
    expect(isChatOriginAllowed("https://store.example.com", allowedOrigins)).toBe(true);
  });

  it("rejects browser origins that are not explicitly configured", () => {
    expect(isChatOriginAllowed("https://attacker.example", allowedOrigins)).toBe(false);
    expect(isChatOriginAllowed("null", allowedOrigins)).toBe(false);
  });

  it("allows requests without an Origin header for native and server clients", () => {
    expect(isChatOriginAllowed(undefined, allowedOrigins)).toBe(true);
  });
});

describe("chat socket authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates an active, verified customer against current database state", async () => {
    mocks.verify.mockReturnValue({
      sub: CUSTOMER_ID,
      identityType: "CUSTOMER",
      sessionVersion: 3,
      roles: [],
      permissions: [],
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 3,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    });

    await expect(resolveChatSocketIdentity(makeSocket({ accessToken: "signed-token" })))
      .resolves.toMatchObject({ type: "CUSTOMER", id: CUSTOMER_ID, sessionVersion: 3 });
  });

  it("rejects a customer token after its session version has been revoked", async () => {
    mocks.verify.mockReturnValue({
      sub: CUSTOMER_ID,
      identityType: "CUSTOMER",
      sessionVersion: 2,
      roles: [],
      permissions: [],
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 3,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    });

    await expect(resolveChatSocketIdentity(makeSocket({ accessToken: "signed-token" })))
      .rejects.toThrow("Customer identity is inactive or unavailable");
  });

  it("requires active staff with the current chat.read permission", async () => {
    mocks.verify.mockReturnValue({
      sub: STAFF_ID,
      identityType: "STAFF",
      roles: [],
      permissions: [],
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    mocks.staffFindUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{
        role: {
          permissions: [{ permission: { name: "chat.read" } }],
        },
      }],
    });

    await expect(resolveChatSocketIdentity(makeSocket({
      authorization: "Bearer signed-token",
    }))).resolves.toMatchObject({ type: "STAFF", id: STAFF_ID });
  });

  it("rejects staff whose current database roles do not grant chat.read", async () => {
    mocks.verify.mockReturnValue({
      sub: STAFF_ID,
      identityType: "STAFF",
      roles: [],
      permissions: ["chat.read"],
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    mocks.staffFindUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { permissions: [] } }],
    });

    await expect(resolveChatSocketIdentity(makeSocket({ accessToken: "signed-token" })))
      .rejects.toThrow("Staff chat access is unavailable");
  });

  it("authenticates guests using the existing HTTP-only guest_session cookie", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.getValidGuestSession.mockResolvedValue({ id: GUEST_SESSION_ID, expiresAt });

    await expect(resolveChatSocketIdentity(makeSocket({
      cookie: `other=value; guest_session=${"a".repeat(64)}`,
    }))).resolves.toEqual({ type: "GUEST", id: GUEST_SESSION_ID, expiresAt });

    expect(mocks.getValidGuestSession).toHaveBeenCalledWith("a".repeat(64));
  });

  it("rejects ambiguous bearer and socket-auth credentials", async () => {
    await expect(resolveChatSocketIdentity(makeSocket({
      accessToken: "socket-token",
      authorization: "Bearer header-token",
    }))).rejects.toThrow("Ambiguous credentials");
  });

  it("rejects missing or duplicated guest-session cookies", async () => {
    await expect(resolveChatSocketIdentity(makeSocket())).rejects.toThrow(
      "Chat authentication required",
    );
    await expect(resolveChatSocketIdentity(makeSocket({
      cookie: `guest_session=${"a".repeat(64)}; guest_session=${"b".repeat(64)}`,
    }))).rejects.toThrow("Chat authentication required");
  });
});

describe("chat conversation room authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a customer to join only a conversation they own", async () => {
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 4,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    });
    mocks.conversationFindFirst.mockResolvedValue({ id: CONVERSATION_ID });

    await expect(canJoinConversation({
      type: "CUSTOMER",
      id: CUSTOMER_ID,
      sessionVersion: 4,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    }, CONVERSATION_ID)).resolves.toBe(true);

    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, customerUserId: CUSTOMER_ID },
      select: { id: true },
    });
  });

  it("denies a customer access to another customer's conversation", async () => {
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      emailVerified: true,
      sessionVersion: 4,
      userRoles: [{ role: { name: "CUSTOMER" } }],
    });
    mocks.conversationFindFirst.mockResolvedValue(null);

    await expect(canJoinConversation({
      type: "CUSTOMER",
      id: CUSTOMER_ID,
      sessionVersion: 4,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    }, CONVERSATION_ID)).resolves.toBe(false);
  });

  it("allows a guest to join only a conversation linked to the validated guest session", async () => {
    mocks.guestSessionFindFirst.mockResolvedValue({ id: GUEST_SESSION_ID });
    mocks.conversationFindFirst.mockResolvedValue({ id: CONVERSATION_ID });

    await expect(canJoinConversation({
      type: "GUEST",
      id: GUEST_SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000),
    }, CONVERSATION_ID)).resolves.toBe(true);

    expect(mocks.conversationFindFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, guestSessionId: GUEST_SESSION_ID },
      select: { id: true },
    });
  });

  it("denies staff whose current database permissions no longer include chat.read", async () => {
    mocks.staffFindUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { permissions: [] } }],
    });

    await expect(canJoinConversation({
      type: "STAFF",
      id: STAFF_ID,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    }, CONVERSATION_ID)).resolves.toBe(false);

    expect(mocks.conversationFindUnique).not.toHaveBeenCalled();
  });

  it("requires current staff chat.read permission before joining a room", async () => {
    mocks.staffFindUnique.mockResolvedValue({
      status: "ACTIVE",
      roles: [{ role: { permissions: [{ permission: { name: "chat.read" } }] } }],
    });
    mocks.conversationFindUnique.mockResolvedValue({ id: CONVERSATION_ID });

    await expect(canJoinConversation({
      type: "STAFF",
      id: STAFF_ID,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
    }, CONVERSATION_ID)).resolves.toBe(true);
  });

  it("rejects expired identities before querying conversation ownership", async () => {
    await expect(canJoinConversation({
      type: "STAFF",
      id: STAFF_ID,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    }, CONVERSATION_ID)).resolves.toBe(false);

    expect(mocks.conversationFindUnique).not.toHaveBeenCalled();
  });
});
