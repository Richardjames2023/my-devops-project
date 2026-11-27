"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Bot, Headphones, MessageCircle, Minimize2, Send, ShieldCheck, X } from "lucide-react";
import { apiRequest, getApiOrigin } from "@/lib/api/client";

type ChatStatus = "BOT_ACTIVE" | "WAITING_FOR_AGENT" | "HUMAN_ACTIVE" | "CLOSED";
type ChatMessage = {
  id: string;
  senderType: "CUSTOMER" | "BOT" | "AGENT" | "SYSTEM";
  content: string;
  createdAt: string;
  senderAgent?: { firstName: string; lastName: string } | null;
};
type Conversation = { id: string; status: ChatStatus };
type ApiEnvelope<T> = { data: T };
type MessagePage = { items: ChatMessage[]; nextCursor: string | null };
type RealtimePage = {
  items: Array<{ sequence: number; event: string; payload: unknown }>;
  nextCursor: number | null;
  lastSequence: number;
  currentSequence: number;
  hasMore: boolean;
};
type ChatSocket = Socket;

const statusCopy: Record<ChatStatus, string> = {
  BOT_ACTIVE: "AI assistant",
  WAITING_FOR_AGENT: "Waiting for customer care",
  HUMAN_ACTIVE: "Connected to customer care",
  CLOSED: "Conversation closed",
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatMessage>;
  return typeof item.id === "string" &&
    typeof item.content === "string" &&
    typeof item.senderType === "string" &&
    typeof item.createdAt === "string";
}

export default function CustomerSupportChat() {
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("offline");
  const [error, setError] = useState("");
  const socketRef = useRef<ChatSocket | null>(null);
  const sequenceRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => current.some((item) => item.id === message.id)
      ? current
      : [...current, message].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  }, []);

  const syncEvents = useCallback(async (conversationId: string) => {
    let cursor = sequenceRef.current;
    let hasMore = true;
    while (hasMore) {
      const response = await apiRequest<ApiEnvelope<RealtimePage>>(
        `/chat/conversations/${conversationId}/events?after=${cursor}&limit=100`,
        { credentials: "include" },
      );
      const page = response.data;
      for (const event of page.items) {
        if (event.sequence <= sequenceRef.current) continue;
        const payload = event.payload as Record<string, unknown> | null;
        if (event.event === "chat:message:new" && payload && isChatMessage(payload)) {
          addMessage(payload);
        } else if (event.event === "chat:conversation:status" && payload &&
          typeof payload.status === "string" &&
          ["BOT_ACTIVE", "WAITING_FOR_AGENT", "HUMAN_ACTIVE", "CLOSED"].includes(payload.status)) {
          setConversation((current) => current
            ? { ...current, status: payload.status as ChatStatus }
            : current);
        }
        sequenceRef.current = event.sequence;
      }
      cursor = page.lastSequence;
      hasMore = page.hasMore;
      if (!page.items.length) hasMore = false;
    }
  }, [addMessage]);

  const loadConversation = useCallback(async () => {
    setStarting(true);
    setError("");
    try {
      const session = await apiRequest<{ guestSession?: { expiresAt: string } | null; authenticated?: boolean }>(
        "/guest-session/status",
        { credentials: "include" },
      );
      if (!session.guestSession) {
        await apiRequest("/guest-session", { method: "POST", credentials: "include" });
      }
      const list = await apiRequest<ApiEnvelope<{ items: Conversation[] }>>(
        "/chat/conversations?limit=1",
        { credentials: "include" },
      );
      let active = list.data.items.find((item) => item.status !== "CLOSED") ?? null;
      if (!active) {
        const created = await apiRequest<ApiEnvelope<{ conversation: Conversation }>>(
          "/chat/conversations",
          { method: "POST", credentials: "include" },
        );
        active = created.data.conversation;
      }
      setConversation(active);
      const history = await apiRequest<ApiEnvelope<MessagePage>>(
        `/chat/conversations/${active.id}/messages?limit=50`,
        { credentials: "include" },
      );
      setMessages(history.data.items);
      sequenceRef.current = 0;
      await syncEvents(active.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't start support chat. Please try again.");
    } finally {
      setStarting(false);
    }
  }, [syncEvents]);

  useEffect(() => {
    if (!open || !conversation) return;
    let cancelled = false;
    const socket = io(getApiOrigin(), {
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    setConnection("connecting");
    socket.on("connect", () => {
      if (cancelled) return;
      setConnection("connected");
      socket.emit("chat:conversation:join", { conversationId: conversation.id }, (ack: { ok?: boolean; error?: string }) => {
        if (!ack?.ok) {
          setError(ack?.error ?? "Unable to join the support conversation.");
          return;
        }
        void syncEvents(conversation.id).catch(() => setError("Some recent chat updates could not be loaded."));
      });
    });
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", () => setConnection("offline"));
    socket.on("chat:message:new", (message: unknown) => {
      if (isChatMessage(message)) addMessage(message);
    });
    socket.on("chat:conversation:status", (payload: { status?: string }) => {
      if (payload?.status && ["BOT_ACTIVE", "WAITING_FOR_AGENT", "HUMAN_ACTIVE", "CLOSED"].includes(payload.status)) {
        setConversation((current) => current ? { ...current, status: payload.status as ChatStatus } : current);
      }
    });
    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [open, conversation, addMessage, syncEvents]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !conversation || busy || conversation.status === "CLOSED") return;
    setBusy(true);
    setError("");
    setDraft("");
    try {
      const response = await apiRequest<ApiEnvelope<{ message: ChatMessage; automation?: { status: string; botMessage?: ChatMessage } }>>(
        `/chat/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          credentials: "include",
          body: { content, clientMessageId: crypto.randomUUID() },
        },
      );
      addMessage(response.data.message);
      if (response.data.automation?.botMessage) addMessage(response.data.automation.botMessage);
      if (response.data.automation?.status === "HANDOFF_RECOMMENDED") {
        setConversation((current) => current ? { ...current, status: "WAITING_FOR_AGENT" } : current);
      }
      if (socketRef.current?.connected) await syncEvents(conversation.id);
    } catch (cause) {
      setDraft(content);
      setError(cause instanceof Error ? cause.message : "Your message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const requestAgent = async () => {
    if (!conversation || conversation.status !== "BOT_ACTIVE" || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<ApiEnvelope<{ conversation: Conversation }>>(
        `/chat/conversations/${conversation.id}/handoff`,
        { method: "POST", credentials: "include" },
      );
      setConversation(response.data.conversation);
      await syncEvents(conversation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't request a customer-care agent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ccb-support-chat">
      {open && (
        <section className="ccb-chat-panel" aria-label="ClickClickBuy customer support" aria-live="polite">
          <header className="ccb-chat-header">
            <div className="ccb-chat-avatar"><Bot size={20}/></div>
            <div className="ccb-chat-heading"><strong>ClickClickBuy Support</strong><span>{conversation ? statusCopy[conversation.status] : "Here to help you"}</span></div>
            <span className={`ccb-chat-connection ccb-chat-connection--${connection}`} title={connection}/>
            <button type="button" onClick={() => setOpen(false)} aria-label="Minimise chat"><Minimize2 size={18}/></button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X size={18}/></button>
          </header>
          {!conversation ? (
            <div className="ccb-chat-start">
              <div className="ccb-chat-welcome-icon"><Headphones size={26}/></div>
              <h3>How can we help?</h3>
              <p>Ask our AI assistant about products, orders, delivery, returns or store policies. You can request a human agent at any time.</p>
              {error && <p className="ccb-chat-error" role="alert">{error}</p>}
              <button type="button" disabled={starting} onClick={() => void loadConversation()}>{starting ? "Connecting…" : "Start a conversation"}</button>
              <small><ShieldCheck size={13}/> Your conversation is securely linked to this browser session.</small>
            </div>
          ) : (
            <>
              <div className="ccb-chat-transcript" ref={listRef}>
                <div className="ccb-chat-intro-note">Welcome to ClickClickBuy. Tell us what you need help with.</div>
                {messages.map((message) => (
                  <div key={message.id} className={`ccb-chat-message ccb-chat-message--${message.senderType.toLowerCase()}`}>
                    {message.senderType === "AGENT" && <span className="ccb-chat-sender">{message.senderAgent ? `${message.senderAgent.firstName} ${message.senderAgent.lastName}` : "Customer care"}</span>}
                    <p>{message.content}</p>
                    <time>{new Intl.DateTimeFormat("en-NG", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
                  </div>
                ))}
                {conversation.status === "WAITING_FOR_AGENT" && <div className="ccb-chat-queue-note">Your request is in the customer-care queue. An agent will join as soon as one is available.</div>}
                {conversation.status === "HUMAN_ACTIVE" && <div className="ccb-chat-queue-note">A customer-care agent has joined the conversation.</div>}
                {conversation.status === "CLOSED" && <div className="ccb-chat-queue-note">This conversation has been closed. Start a new conversation to contact us again.</div>}
              </div>
              {error && <p className="ccb-chat-error ccb-chat-inline-error" role="alert">{error}</p>}
              <form className="ccb-chat-compose" onSubmit={send}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} placeholder={conversation.status === "CLOSED" ? "Conversation closed" : "Type your message…"} disabled={busy || conversation.status === "CLOSED"} aria-label="Your message"/>
                <button type="submit" disabled={busy || !draft.trim() || conversation.status === "CLOSED"} aria-label="Send message"><Send size={17}/></button>
              </form>
              <div className="ccb-chat-footer">
                {conversation.status === "BOT_ACTIVE" ? <button type="button" onClick={() => void requestAgent()} disabled={busy}><Headphones size={14}/> Talk to a human agent</button> : <span>{conversation.status === "WAITING_FOR_AGENT" ? "An agent will be with you shortly" : conversation.status === "HUMAN_ACTIVE" ? "You&apos;re speaking with customer care" : "Need more help? Start a new chat soon"}</span>}
                <small>AI support may make mistakes. Please don't share passwords or payment details.</small>
              </div>
            </>
          )}
        </section>
      )}
      <button type="button" className="ccb-chat-launcher" onClick={() => { setOpen((value) => !value); if (!open && !conversation) void loadConversation(); }} aria-label={open ? "Close customer support chat" : "Open customer support chat"}>
        {open ? <X size={22}/> : <><MessageCircle size={21}/><span>Need help?</span></>}
      </button>
    </div>
  );
}
