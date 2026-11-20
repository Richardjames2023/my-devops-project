import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  middleware: undefined as undefined | ((socket: any, next: (error?: Error) => void) => void),
  connection: undefined as undefined | ((socket: any) => void),
  userFindUnique: vi.fn(),
  guestSessionFindFirst: vi.fn(),
  conversationFindFirst: vi.fn(),
  getValidGuestSession: vi.fn(),
}));

vi.mock("socket.io", () => ({
  Server: class {
    use(handler: typeof state.middleware) { state.middleware = handler; }
    on(event: string, handler: typeof state.connection) {
      if (event === "connection") state.connection = handler;
    }
  },
}));

vi.mock("../src/infrastructure/prisma/client", () => ({
  default: {
    user: { findUnique: state.userFindUnique },
    staffAccount: { findUnique: vi.fn() },
    guestSession: { findFirst: state.guestSessionFindFirst },
    chatConversation: {
      findFirst: state.conversationFindFirst,
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../src/modules/guest-session/guest-session.service", () => ({
  getValidGuestSession: state.getValidGuestSession,
}));

import { createChatRealtimeServer } from "../src/modules/chat/chat-realtime.server";

const GUEST_ID = "b4a7bba8-78bb-4c40-8b1b-4cb35df50e11";

function makeSocket() {
  const disconnectHandlers: Array<() => void> = [];
  const socket: any = {
    handshake: {
      auth: {},
      headers: { cookie: `guest_session=${"a".repeat(64)}` },
    },
    data: {},
    rooms: new Set(["socket-id"]),
    connected: true,
    join: vi.fn(async (room: string) => { socket.rooms.add(room); }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      for (const handler of disconnectHandlers) handler();
    }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "disconnect") disconnectHandlers.push(handler);
    }),
  };
  return socket;
}

async function connectSocket() {
  const socket = makeSocket();
  const next = vi.fn();
  state.middleware!(socket, next);
  await vi.waitFor(() => expect(next).toHaveBeenCalled());
  expect(next).toHaveBeenCalledWith();
  state.connection!(socket);
  return socket;
}

function conversationId(index: number): string {
  return `d4a7bba8-78bb-4c40-8b1b-${index.toString(16).padStart(12, "0")}`;
}

describe("Socket.IO conversation room lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.middleware = undefined;
    state.connection = undefined;
    state.getValidGuestSession.mockResolvedValue({
      id: GUEST_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });
    state.guestSessionFindFirst.mockResolvedValue({ id: GUEST_ID });
    state.conversationFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    }));
  });

  it("rejects unauthenticated connections through Socket.IO middleware", async () => {
    state.getValidGuestSession.mockResolvedValue(null);
    createChatRealtimeServer({} as any, []);
    const socket = makeSocket();
    const next = vi.fn();

    state.middleware!(socket, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(state.connection).toBeDefined();
  });

  it("joins an authorized conversation and acknowledges the result", async () => {
    createChatRealtimeServer({} as any, []);
    const socket = await connectSocket();
    const joinHandler = socket.on.mock.calls.find(([event]: [string]) =>
      event === "chat:conversation:join",
    )?.[1];
    expect(joinHandler).toBeTypeOf("function");

    const ack = vi.fn();
    joinHandler({ conversationId: conversationId(1) }, ack);
    await vi.waitFor(() => expect(ack).toHaveBeenCalled());

    expect(ack).toHaveBeenCalledWith({ ok: true, conversationId: conversationId(1) });
    expect(socket.rooms.has(`chat:conversation:${conversationId(1)}`)).toBe(true);
    socket.disconnect();
  });

  it("does not count duplicate concurrent joins as separate rooms", async () => {
    let resolveAuthorization!: (value: { id: string } | null) => void;
    state.conversationFindFirst.mockImplementationOnce(() =>
      new Promise((resolve) => { resolveAuthorization = resolve; }),
    );
    createChatRealtimeServer({} as any, []);
    const socket = await connectSocket();
    const joinHandler = socket.on.mock.calls.find(([event]: [string]) =>
      event === "chat:conversation:join",
    )?.[1];
    const id = conversationId(77);
    const firstAck = vi.fn();
    const secondAck = vi.fn();

    joinHandler({ conversationId: id }, firstAck);
    await vi.waitFor(() => expect(resolveAuthorization).toBeTypeOf("function"));
    joinHandler({ conversationId: id }, secondAck);
    resolveAuthorization({ id });

    await vi.waitFor(() => {
      expect(firstAck).toHaveBeenCalled();
      expect(secondAck).toHaveBeenCalled();
    });
    expect([...socket.rooms].filter((room: string) =>
      room === `chat:conversation:${id}`,
    )).toHaveLength(1);
    expect(firstAck).toHaveBeenCalledWith({ ok: true, conversationId: id });
    expect(secondAck).toHaveBeenCalledWith({ ok: true, conversationId: id });
    socket.disconnect();
  });

  it("caps concurrent distinct room joins at 50", async () => {
    createChatRealtimeServer({} as any, []);
    const socket = await connectSocket();
    const joinHandler = socket.on.mock.calls.find(([event]: [string]) =>
      event === "chat:conversation:join",
    )?.[1];

    const acknowledgements = Array.from({ length: 55 }, () => vi.fn());
    for (let index = 0; index < acknowledgements.length; index += 1) {
      joinHandler({ conversationId: conversationId(index + 1) }, acknowledgements[index]);
    }

    await vi.waitFor(() =>
      expect(acknowledgements.every((ack) => ack.mock.calls.length === 1)).toBe(true),
    );

    const joinedRooms = [...socket.rooms].filter((room: string) =>
      room.startsWith("chat:conversation:"),
    );
    expect(joinedRooms).toHaveLength(50);
    expect(acknowledgements.filter((ack) => ack.mock.calls[0]?.[0].ok)).toHaveLength(50);
    expect(acknowledgements.filter((ack) =>
      ack.mock.calls[0]?.[0].error === "Too many active conversations",
    )).toHaveLength(5);
    socket.disconnect();
  });

  it("does not join a room when the socket disconnects during authorization", async () => {
    let resolveAuthorization!: (value: { id: string } | null) => void;
    state.conversationFindFirst.mockImplementationOnce(() =>
      new Promise((resolve) => { resolveAuthorization = resolve; }),
    );
    createChatRealtimeServer({} as any, []);
    const socket = await connectSocket();
    const joinHandler = socket.on.mock.calls.find(([event]: [string]) =>
      event === "chat:conversation:join",
    )?.[1];
    const ack = vi.fn();

    joinHandler({ conversationId: conversationId(99) }, ack);
    await vi.waitFor(() => expect(resolveAuthorization).toBeTypeOf("function"));
    socket.disconnect();
    resolveAuthorization({ id: conversationId(99) });
    await vi.waitFor(() => expect(ack).toHaveBeenCalled());

    expect(socket.join).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Socket is disconnected" });
  });
});
