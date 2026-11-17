# AI Customer Chatbot and Human Handoff

**Status:** Phase 1 implementation in progress  
**Target repository:** `Richardjames2023/my-devops-project`  
**Implementation branch:** `feat/ai-chatbot-human-handoff`  
**Last updated:** 2026-11-17

## 1. Purpose

Deliver a website customer-support chat experience that starts with automated AI assistance and can transfer a conversation to a human customer-care agent. Human agents should work from the existing admin application wherever its frontend architecture permits; the project should not create a separate staff identity or authentication system.

The backend is the source of truth for conversation ownership, state transitions, message persistence, authorization and AI invocation.

## 2. Repository facts and constraints

The backend currently uses:

- Express 5 and TypeScript (not NestJS).
- Prisma ORM and PostgreSQL.
- Existing customer and staff authentication.
- `StaffAccount`, staff roles and permission-based authorization.
- Existing notification outbox and staff notification inbox.
- Existing product, order, payment, delivery, returns and warranty modules.
- An HTTP server started from `src/server.ts`, with graceful shutdown handling.

Implementation must follow the existing Express route/controller/service pattern and Prisma conventions. Do not introduce NestJS.

The inspected backend repository does not establish which frontend repository powers the storefront/admin UI. The customer widget and admin inbox integration therefore require confirmation of the frontend repository and its framework before frontend work begins.

## 3. Product scope

### Customer-facing widget

- Floating chat launcher and responsive conversation panel.
- Guest and authenticated-customer sessions.
- Welcome message and suggested questions.
- Persistent conversation history for the session.
- AI responses while the conversation is in bot mode.
- Explicit **Talk to Customer Care** action.
- Clear waiting, agent-connected and closed states.
- Reconnection and history recovery after refresh or temporary network loss.

### Existing admin application

- Support inbox with waiting, active and closed conversations.
- Conversation history, including prior AI messages.
- Assignment to an authorized active staff account.
- Live agent/customer messaging.
- Resolve/close action.
- Agent identity and timestamps in the transcript.
- Access controlled by staff permissions.

### Initial AI knowledge and business integrations

Start with approved FAQs and store policies. Add read-only product/catalog assistance next. Order, payment, delivery, return and warranty information must be retrieved through existing backend services with customer ownership checks. Do not expose arbitrary database access or unrestricted tools to the model.

## 4. Conversation lifecycle

Use explicit backend-owned states:

| State | Meaning | Who may send replies |
|---|---|---|
| `BOT_ACTIVE` | Automated assistant is handling the conversation | Customer and AI |
| `WAITING_FOR_AGENT` | Handoff requested; conversation awaits assignment | Customer and system; AI is paused |
| `HUMAN_ACTIVE` | An agent has accepted/been assigned and is handling the conversation | Customer and assigned/authorized agent |
| `CLOSED` | Conversation is resolved and closed | No new replies; a new conversation may be opened |

Allowed transitions:

- `BOT_ACTIVE -> WAITING_FOR_AGENT`: explicit customer request, validated AI escalation recommendation, or policy rule.
- `WAITING_FOR_AGENT -> HUMAN_ACTIVE`: authorized agent claims/accepts the conversation.
- `HUMAN_ACTIVE -> CLOSED`: authorized agent resolves the conversation.
- `HUMAN_ACTIVE -> WAITING_FOR_AGENT`: optional future reassignment/requeue flow; only if explicitly implemented.
- Reopening a closed conversation should create a new conversation initially; do not silently reopen old records.

The API must reject invalid transitions. Never trust a status value supplied by the customer widget.

## 5. Proposed architecture

### Backend

- Express REST endpoints for session creation, history, message submission, handoff, inbox, assignment and closure.
- Socket.IO attached to the existing Node HTTP server for live delivery.
- PostgreSQL/Prisma as durable source of truth.
- A provider-neutral AI service interface; provider adapters can support OpenAI and Gemini.
- Approved FAQ/policy retrieval and narrowly scoped business-data tools.
- Existing notification outbox for durable agent handoff alerts.
- Redis Socket.IO adapter only when multiple backend instances require cross-instance event delivery.

REST persists and authorizes operations. Socket.IO delivers persisted events in real time; it is not the system of record. On reconnect, clients fetch missed messages from the REST API.

### AI provider and cost controls

- Provider/model are configuration, not hard-coded business logic.
- API credentials remain server-side and are never sent to browsers.
- ChatGPT subscriptions do not pay for API usage; provider API billing is separate.
- Set per-message token limits, bounded conversation context, request timeouts, rate limits and per-conversation usage tracking.
- Do not call the AI when state is `WAITING_FOR_AGENT`, `HUMAN_ACTIVE` or `CLOSED`.
- Support a disabled/unconfigured AI mode with a safe response and human handoff.
- Before production, review provider retention, training/data-use terms, applicable privacy requirements and the client's approval of sending customer content to the selected provider. Do not send payment credentials, passwords, access tokens or unnecessary personal data to an AI provider.

## 6. Data model proposal

Use separate records for conversations, messages and lifecycle events. Reuse existing `User` and `StaffAccount` records.

### ChatConversation

- UUID primary key.
- Optional `customerUserId` relation for authenticated customers.
- Optional `guestSessionId` relation to the existing `GuestSession` record. Reuse the existing hashed-token, expiry and revocation lifecycle; never store the raw guest token in chat records.
- Conversation status enum.
- Optional `assignedAgentId` relation to `StaffAccount`.
- `lastMessageAt`, `closedAt`, `createdAt`, `updatedAt`.
- Indexes for status/last activity, customer, and assigned agent.

### ChatMessage

- UUID primary key and conversation relation.
- Sender type: `CUSTOMER`, `BOT`, `AGENT`, `SYSTEM`.
- Message text, optional safe metadata, created timestamp.
- Optional staff sender relation for agent messages.
- Index by conversation and creation time.
- Enforce maximum message length and reject empty/unsupported payloads.

### ChatEvent

- UUID primary key and conversation relation.
- Event type for state changes, handoff requests, assignment, agent acceptance and closure.
- Previous/new state where applicable.
- Optional acting staff relation and structured, non-sensitive metadata.
- Created timestamp and conversation/time index.

Customer deletion and retention behavior must be explicitly integrated with the existing account-deletion lifecycle before production. Avoid cascading deletion of operational support history without a retention decision; redact or detach customer identity according to the approved policy.

## 7. REST API proposal

Public/customer endpoints:

- `POST /api/v1/chat/conversations` — create a guest or authenticated conversation.
- `GET /api/v1/chat/conversations/:conversationId/messages` — retrieve history after ownership/session-token verification.
- `POST /api/v1/chat/conversations/:conversationId/messages` — persist a customer message and route according to conversation state.
- `POST /api/v1/chat/conversations/:conversationId/handoff` — request human support idempotently.

Staff endpoints (existing staff authentication and new chat permissions required):

- `GET /api/v1/staff/chat/conversations?status=...` — inbox/queue.
- `GET /api/v1/staff/chat/conversations/:conversationId` — transcript and conversation details.
- `POST /api/v1/staff/chat/conversations/:conversationId/assign` — claim/assign.
- `POST /api/v1/staff/chat/conversations/:conversationId/messages` — agent reply.
- `POST /api/v1/staff/chat/conversations/:conversationId/close` — resolve and close.

Exact request/response schemas and pagination conventions must follow existing route validation patterns.

## 8. Socket.IO event contract (proposed)

Client to server:
- `chat:conversation:join` — join only after REST-backed authorization.
- `chat:message:send` — submit a message using the same validation and persistence service as REST.
- `chat:typing:start` / `chat:typing:stop` — ephemeral typing indicators only.

Server to client:
- `chat:message:new` — message has been persisted.
- `chat:conversation:status` — validated state transition.
- `chat:conversation:assigned` — agent assignment/acceptance.
- `chat:agent:typing` — ephemeral typing indicator.
- `chat:error` — safe, non-sensitive error.

Every socket join and send must verify conversation access. Do not trust room names or IDs from the client. Use per-conversation rooms only after authorization. Agent sockets require active staff authentication and appropriate permissions.

## 9. Handoff and message-routing rules

1. Authenticate the caller or validate the guest session token.
2. Load and authorize the conversation; lock or otherwise serialize concurrent state-sensitive operations.
3. Persist the customer message with an idempotency key to prevent duplicate submissions.
4. If `BOT_ACTIVE`, call the configured AI adapter with bounded, approved context.
5. Validate the AI response against a strict schema. The AI may recommend handoff and provide a reason, but cannot mutate state or execute arbitrary actions.
6. If handoff is required, atomically transition to `WAITING_FOR_AGENT`, persist a system message/event and enqueue an agent notification.
7. If `WAITING_FOR_AGENT` or `HUMAN_ACTIVE`, do not invoke AI.
8. For human replies, verify agent permissions and assignment/claim rules, persist the reply, then emit it to the authorized conversation room.
9. On closure, persist the state/event and stop further replies.

Concurrent agent claims must be atomic so two agents cannot claim the same waiting conversation.

## 10. Security, privacy and abuse controls

- Reuse existing customer/staff authentication and authorization.
- Add least-privilege permissions such as `chat.read`, `chat.reply`, `chat.assign`, `chat.manage`; seed and assign these deliberately.
- Guest tokens must be cryptographically random, high entropy, short/rotatable where appropriate, stored hashed and rate-limited.
- Apply rate limits to session creation, customer messages, handoff requests and agent actions.
- Validate payloads, message sizes, allowed origins and socket event schemas.
- Escape/render customer and AI content safely in the frontend; do not render arbitrary HTML.
- Treat customer messages and retrieved documents as untrusted prompt content.
- AI tools must be allowlisted, read-only initially, and enforce customer ownership on every private-data lookup.
- Do not permit AI to initiate payments, refunds, cancellations, account changes or other irreversible operations.
- Audit assignments, state transitions and agent actions.
- Define transcript retention, deletion/anonymization and privacy notices before production.

## 11. Delivery phases

### Phase 0 — Design and repository alignment
- Confirm the storefront/admin frontend repository and framework.
- Confirm support-agent roles and which staff can view/claim conversations.
- Agree on guest identification, transcript retention and privacy notice.
- Select an AI provider after quality, pricing and data-use evaluation.

### Phase 1 — Durable chat foundation
- Add Prisma models and SQL migration.
- Add public conversation/session creation, history and message persistence.
- Add state-transition service and authorization tests.
- No AI provider or WebSocket dependency required for this phase.

### Phase 2 — AI responses and controlled knowledge
- Add provider interface and one configured adapter.
- Add FAQ/policy context retrieval.
- Add validated handoff recommendation and usage/cost telemetry.
- Add timeouts, provider failure behavior and AI-disabled behavior.

### Phase 3 — Human handoff and real-time transport
- Attach Socket.IO to the existing HTTP server and graceful shutdown.
- Add staff inbox, claim/assignment, agent replies and closure APIs.
- Add durable handoff notifications through the existing outbox.
- Add authenticated socket rooms and reconnect/history recovery.

### Phase 4 — Frontend integration and business context
- Add the customer widget to the storefront.
- Integrate agent inbox into the existing admin UI.
- Add product/catalog assistance, then authorized order/delivery/return/warranty lookups.
- Add reporting and operational dashboards.

## 12. Acceptance criteria

- A guest can start a chat without receiving access to another guest's conversation.
- An authenticated customer can access only their own conversations.
- Customer messages are persisted before they are broadcast or sent to AI.
- Duplicate submissions do not create duplicate messages.
- AI is called only in `BOT_ACTIVE`.
- Explicit handoff reliably moves a conversation to `WAITING_FOR_AGENT`.
- A permitted agent can claim a waiting conversation; concurrent claims cannot both succeed.
- In `HUMAN_ACTIVE`, customer messages reach the assigned agent and never trigger AI.
- Unauthorized staff cannot view, assign or reply to conversations.
- Reconnecting clients can recover missed persisted messages.
- AI outages do not lose customer messages and provide a safe fallback.
- Tests cover state transitions, ownership, staff permissions, rate limits, concurrency, provider failures and retention behavior.

## 13. Open decisions

1. Which repository and framework contain the storefront and existing admin frontend?
2. Which existing staff role(s) should receive `chat.read`, `chat.reply` and `chat.assign`?
3. Should guests be asked for name/email before starting, or remain anonymous until escalation?
4. What transcript retention and customer-account deletion policy should apply?
5. Which AI provider/model is approved for production, and what monthly spend limit should be configured?
6. What support hours and fallback message should be shown when no agent is available?

## 14. Initial implementation boundary

Start with Phase 1 on this feature branch. Keep the first database/API change independent of AI vendor and Socket.IO. This creates a tested, durable conversation foundation before adding external-provider costs and real-time complexity.
