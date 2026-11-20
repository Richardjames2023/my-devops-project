# AI Customer Chatbot and Human Handoff

**Status:** Chat foundation, AI responses, staff inbox/replies/closure, durable handoff notifications, Socket.IO transport, socket authentication, authorized conversation rooms and persisted realtime event broadcasting implemented; reconnect/history recovery and frontend integration remain planned
**Target repository:** `Richardjames2023/my-devops-project`  
**Implementation branch:** `feat/ai-chatbot-human-handoff`  
**Last updated:** 2026-11-20

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

- `BOT_ACTIVE -> WAITING_FOR_AGENT`: explicit customer request, a validated AI escalation recommendation, or an enforced backend policy rule. The backend—not the model—performs the transition.
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
- `GET /api/v1/chat/conversations` — list the caller’s conversations.
- `GET /api/v1/chat/conversations/:conversationId` — retrieve conversation details after ownership verification.
- `GET /api/v1/chat/conversations/:conversationId/messages` — retrieve paginated history after ownership/session verification.
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
6. If handoff is recommended, the backend transaction that persists the bot reply also transitions the conversation to `WAITING_FOR_AGENT` and persists one `HANDOFF_REQUESTED` event plus a system message. An explicit customer handoff uses the same target state and remains idempotent. Durable agent notification delivery is not implemented in this slice.
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
- [x] Add Prisma models and SQL migration.
- [x] Add customer/guest conversation creation, listing, ownership-protected details and paginated message history.
- [x] Add idempotent customer message persistence and atomic customer handoff transition.
- [x] Add PostgreSQL integration coverage for ownership, pagination, idempotency and concurrent handoff.
- [x] Add staff inbox, assignment, agent reply and closure endpoints (implemented in the staff operations slice).
- [x] Run Prisma validation, client generation, TypeScript build and PostgreSQL integration tests locally.
- Staff inbox, assignment, agent-reply and closure endpoints are implemented and covered by PostgreSQL integration tests.

### Phase 2 — AI responses and controlled knowledge
- [x] Add provider interface and the Gemini adapter.
- [x] Load the customer-support knowledge base and require explicit approval before sending it to the provider.
- [x] Validate structured replies and handoff recommendations.
- [x] Add bounded history, request timeout, output-token limit, disabled mode and provider-failure handling.
- [x] Add PostgreSQL-backed generation leases, bounded retries, idempotent persistence and stale-worker protection.
- [ ] Add usage and cost telemetry.

### Phase 3 — Staff operations and real-time transport
- [x] Attach Socket.IO to the existing HTTP server with the configured CORS origin allowlist.
- [x] Stop realtime connections before HTTP/job draining and Prisma disconnect during graceful shutdown.
- [x] Add staff inbox, claim/assignment, agent replies and closure APIs.
- [x] Add durable handoff notifications through the existing outbox.
  - Customer-requested and AI-recommended handoffs publish the outbox event in the same transaction as the state transition.
  - Active staff with `chat.read` receive mandatory in-app alerts; email remains disabled for this event.
- [x] Authenticate customer sockets against active/verified customer records and session versions; authenticate guests through the existing hashed guest-session cookie; authenticate staff against current active status and `chat.read` permission.
- [x] Authorize conversation-room joins against current customer/guest ownership or current staff `chat.read` permission; periodically recheck identity validity and disconnect expired/revoked identities.
- [x] Broadcast committed customer, AI and staff messages and conversation lifecycle events to authorized conversation rooms after database transactions commit.
  - `chat:message:new` carries the persisted message record for customer, AI, system handoff and staff messages.
  - `chat:conversation:status` carries committed status, assignment and closure metadata.
  - `chat:conversation:assigned` identifies the assigned staff agent.
  - Idempotent retries do not rebroadcast already-persisted messages or repeated lifecycle transitions.
  - Socket.IO remains delivery-only; REST continues to own writes and PostgreSQL remains the source of truth.
- [ ] Add reconnect/history recovery using the existing paginated REST history endpoints.

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
- Explicit customer handoff and validated AI handoff recommendations reliably move a conversation to `WAITING_FOR_AGENT` with one event and system message.
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

The initial implementation established the durable conversation foundation before adding AI-provider integration. The current branch contains that foundation and the AI-response backend. Staff inbox/assignment/reply endpoints and durable handoff notifications are implemented. Socket.IO is attached to the HTTP server with origin enforcement and graceful shutdown. Customer, guest and staff socket authentication plus ownership/permission-checked conversation rooms are implemented. Persisted customer, AI, system and staff messages plus handoff, assignment and closure transitions are broadcast after commit to authorized conversation rooms. Reconnect/history recovery, frontend integration, and usage/cost telemetry remain follow-up work.
