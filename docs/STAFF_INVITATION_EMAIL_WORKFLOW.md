# Staff Invitation Email and Secure Acceptance Workflow

**Status:** Backend implementation in progress — awaiting local verification  
**Repository area:** Backend staff invitations and notification email delivery  
**Product:** ClickClickBuy  
**Last reviewed:** 2026-11-14

> This document is the source of truth for the Staff Invitation Email Workflow. Update its checklists and decisions as implementation progresses. A checked item means the code and tests have been verified; it must not be checked merely because the design has been discussed.

## 1. Purpose and scope

Implement a secure, reliable staff invitation flow using the existing staff invitation lifecycle and the existing Resend-backed email delivery infrastructure.

The backend is being completed before frontend development begins. Backend work must therefore expose a stable, documented acceptance API and configurable frontend URL without assuming that the frontend page already exists.

### Goals

- Deliver staff invitations through email rather than exposing raw invitation tokens in admin API responses.
- Preserve existing invitation hashing, expiry, revocation, resend rotation, role-delegation checks, audit logging, and concurrency protections.
- Keep raw invitation tokens out of persistent plaintext storage and application logs.
- Reduce token exposure through URL handling.
- Exchange an invitation token for a short-lived, invitation-scoped acceptance session.
- Make delivery resilient to retries, worker restarts, duplicate jobs, and invitation resends.
- Keep the implementation compatible with the existing email provider, worker, webhook, and delivery-operations infrastructure.

### Out of scope for this backend phase

- Building the frontend acceptance page.
- Building staff registration forms or frontend validation UI.
- Assuming that the proposed page route is already deployed.
- Replacing the existing email provider or ordinary notification architecture.

## 2. Existing implementation baseline

The following were identified during the initial repository review. Re-verify these details against the code before changing them.

- Staff invitations already generate cryptographically random tokens.
- Only a hash of the invitation token is persisted for invitation validation.
- Email addresses are normalized.
- Invitation expiry currently defaults to seven days, with a maximum of 30 days.
- Duplicate pending invitations are protected by a PostgreSQL advisory lock keyed by normalized email.
- Resending rotates the invitation token hash and expiry.
- Acceptance has database concurrency/replay protections.
- Revocation and audit logging are supported.
- The create/resend admin responses currently return the raw invitation token to the trusted caller; this must change when email delivery becomes authoritative.
- The backend acceptance API already exists at `POST /api/v1/staff-auth/accept-invitation`.
- Existing email infrastructure uses Resend, email templates, a background worker, delivery retries/leases, webhook event handling, and operational retry/dead-letter support.
- Email delivery can exist independently of an ordinary in-app notification. Staff invitations should remain a dedicated security-sensitive email workflow, not be treated as a routine notification event.

**Preservation requirement:** Do not weaken or remove the existing advisory-lock, row-lock/conditional-claim, role-delegation, audit, or invitation lifecycle protections while integrating email delivery.

## 3. Target end-to-end flow

### 3.1 Create invitation

1. An authorized staff administrator requests an invitation.
2. Backend validates authorization, role delegation, recipient email, and invitation constraints.
3. Backend generates a cryptographically secure, high-entropy random invitation token.
4. Backend stores only the token hash in the invitation record.
5. Backend encrypts the raw token using authenticated encryption with a dedicated invitation-email encryption key.
6. Backend creates the invitation email delivery record in the same database transaction as invitation creation.
7. Admin API returns a delivery/invitation result, but **does not return the raw invitation token**.
8. The existing email worker claims the queued delivery and sends it through Resend.

### 3.2 Resend invitation

1. Administrator requests a resend.
2. Backend rotates the invitation token and updates the stored hash and expiry.
3. Backend queues a newly encrypted email delivery transactionally with the rotation.
4. Older queued/retrying deliveries for the same invitation are suppressed where possible.
5. Before sending, the worker locks the invitation row and verifies that the invitation is still pending, unexpired, addressed to the queued recipient, and that the decrypted token hashes to the invitation's current token hash. It holds that lock through provider acceptance and the delivery's `ACCEPTED` update. Resend/revoke take the same invitation lock, so the send and state change are serialized.
6. If the token is no longer current, the old delivery is suppressed and must not be sent.

### 3.3 Invitation email URL

Preferred URL shape:

```text
https://clickclickbuy.ng/staff/accept-invitation#token=<ONE_TIME_TOKEN>
```

The frontend route above is a **proposed route only**. The final route must be configurable and confirmed when the frontend is built.

Use a URL fragment (`#token=...`) rather than a query parameter (`?token=...`) where the frontend architecture permits it. The configured acceptance URL must use HTTP or HTTPS in every environment; HTTP is permitted only outside production, while production requires HTTPS. Credentials, query strings, and fragments in the configured base URL are rejected. A fragment is not included in the initial HTTP request to the web server, reducing exposure in ordinary server access logs and HTTP referrer headers. It does not eliminate exposure through browser history, copied links, screenshots, browser extensions, or client-side scripts.

Do not put invitation tokens in:
- Query parameters.
- Analytics events or telemetry.
- Application logs, tracing spans, error reports, or support logs.
- Email delivery provider metadata unless the provider requires it (it should not).
- Ordinary notification payloads or audit log metadata.

### 3.4 Frontend link handling (future frontend phase)

The frontend must implement all of the following:

1. Read the token from the URL fragment.
2. Keep it only in short-lived in-memory state while the page is active.
3. Immediately remove the fragment from the visible browser URL using `history.replaceState`.
4. Do not automatically exchange/consume the token just because the page loaded.
5. Require an explicit user action (for example, a Continue button) before submitting the token to the backend. This reduces accidental consumption by email security scanners that pre-open links.
6. Submit the token to the backend over HTTPS in a POST request body, never as a query parameter.
7. After exchange, complete registration using the short-lived acceptance session.
8. Do not load third-party analytics, advertising, chat widgets, external fonts, or unrelated third-party resources on the acceptance page unless a future security review explicitly approves them.

The frontend must not persist the raw token in localStorage, sessionStorage, cookies accessible to JavaScript, IndexedDB, or application state persistence.

### 3.5 Token exchange and acceptance session

Implemented backend API contract:

- `POST /api/v1/staff-auth/invitation/exchange` accepts `{ "token": "..." }` in the JSON body and sets the restricted `staff_invitation_session` HttpOnly cookie.
- `POST /api/v1/staff-auth/accept-invitation` accepts only `{ "password": "...", "firstName": "...", "lastName": "..." }`; the token is not accepted in this request.
- Both endpoints require the `Origin` header to match the configured acceptance page origin and return `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The cookie is scoped to `/api/v1/staff-auth`, is HttpOnly, uses Secure in production, and uses the configured `COOKIE_SAME_SITE` policy.

The API contract replaces the former direct-token acceptance body. The frontend must use the exchange endpoint before calling completion.

1. Frontend explicitly POSTs the raw invitation token to a dedicated backend exchange endpoint over HTTPS.
2. Backend hashes the submitted token and validates the matching invitation:
   - Invitation exists.
   - Invitation is pending.
   - Invitation has not expired.
   - Invitation has not been revoked or accepted.
   - Token hash matches the current invitation token hash.
3. Backend creates a cryptographically random, opaque, short-lived acceptance-session credential.
4. Backend stores only a hash of the acceptance-session credential, linked to the specific invitation and its expiry/state.
5. Backend sets the credential in a secure cookie where the deployment topology supports it:
   - `HttpOnly`
   - `Secure`
   - Appropriate `SameSite` policy (prefer Strict where compatible; otherwise justify Lax/None based on the actual frontend/API origin arrangement).
   - Narrowest practical host/path scope.
   - Short expiry (target: 15 minutes).
6. Session is restricted to completing the associated invitation. It is not a general staff login session and cannot authorize unrelated APIs.
7. Final acceptance consumes the invitation and invalidates the acceptance session atomically.
8. Expired, revoked, resent, accepted, or otherwise superseded invitations must not be accepted through an old session.

If the frontend and API are on different origins, review cookie/CORS/CSRF behavior before finalizing the contract. Do not weaken cookie security merely to make cross-origin requests work. Validate the expected Origin and use an appropriate CSRF defense for cookie-authenticated state-changing requests.

### 3.6 Complete registration

- Backend accepts registration only through a valid, unexpired, invitation-scoped acceptance session.
- Acceptance must be single-use and safe under concurrent requests.
- Invitation state transition, staff identity creation/activation, session consumption, and required audit records must be transactionally consistent.
- Replays and concurrent acceptance attempts must fail safely.
- Existing role-delegation and staff identity rules remain enforced.

## 4. Token and cryptographic requirements

### Invitation token

- Generate using a cryptographically secure random source.
- Use sufficient entropy (target at least 256 bits).
- Encode using a URL-safe representation.
- Store only a one-way SHA-256 hash for lookup/validation.
- Never log the raw token.
- Treat the token as a bearer credential until it is exchanged, expired, revoked, rotated, or consumed.

### Email queue encryption

The raw token is needed later by the email worker, so encrypt it before persisting the delivery record.

- Use authenticated encryption: AES-256-GCM is the proposed algorithm.
- Use a fresh, cryptographically random nonce for every encryption operation.
- Persist a versioned envelope containing the algorithm/version, nonce, authentication tag, and ciphertext.
- Use a dedicated secret such as `STAFF_INVITATION_ENCRYPTION_KEY`; do not reuse JWT secrets, database credentials, Resend API keys, or other application secrets.
- Key material must be 32 random bytes, supplied through the deployment secret manager/environment, with a documented encoding and strict validation.
- Never commit real key material or example production secrets.
- Include a key identifier in every envelope. Configure `STAFF_INVITATION_ENCRYPTION_KEYRING` as a JSON object mapping key IDs to canonical base64-encoded 32-byte keys, and set `STAFF_INVITATION_ENCRYPTION_ACTIVE_KEY_ID` to the key used for new encryptions. Retain historical keys until every queued/retrying delivery encrypted with them has been accepted or suppressed. The legacy `STAFF_INVITATION_ENCRYPTION_KEY` remains supported as key ID `v1`.
- Decrypt only in the dedicated invitation email delivery path, immediately before rendering/sending.
- Do not include decrypted tokens in errors, logs, traces, metrics, or provider metadata.
- If decryption fails, fail safely and surface an operationally useful error without exposing ciphertext or token material.

### Acceptance-session credential

- Generate independently from the invitation token using a cryptographically secure random source.
- Store only a hash of the credential.
- Bind it to one invitation and a short expiry (target: 15 minutes).
- Make it single-use and invalidate it after successful acceptance.
- Invalidate it when the invitation is revoked, expires, is resent/rotated, or is accepted.
- Never treat it as a normal staff authentication or refresh token.

## 5. Email delivery and worker behavior

- Reuse the existing Resend provider and delivery worker infrastructure.
- Use a dedicated invitation template key and a dedicated rendering path.
- Do not classify staff invitations as ordinary in-app notifications.
- Queue email delivery in the same database transaction as invitation create/resend and token rotation.
- Use a stable idempotency/deduplication key for each invitation version/delivery.
- Ensure retries do not create duplicate active invitation tokens or send superseded tokens.
- Before every send attempt, verify invitation status, expiry, and token-hash currency.
- Suppress stale, revoked, expired, accepted, or superseded deliveries.
- Preserve existing worker lease, retry/backoff, dead-letter, and provider webhook behavior.
- Do not mark an invitation as accepted or valid merely because the provider accepted an email.
- Delivery failures must be observable to authorized operators without revealing the invitation token.
- Admin create/resend responses must not disclose raw tokens after email delivery is integrated.

## 6. URL, HTTP headers, logging, and hosting protections

### Backend responsibilities

- Enforce HTTPS in production and generate links only from a validated configured acceptance base URL.
- Add/verify a strict `Referrer-Policy: no-referrer` for relevant API responses and any backend-served acceptance-related pages.
- Ensure request logging, error logging, tracing, and audit metadata redact token-bearing values and sensitive headers/cookies.
- Do not log request bodies for token exchange or acceptance endpoints.
- Avoid echoing submitted tokens in validation errors.
- Apply rate limits to token exchange and acceptance endpoints. Use generic failure responses where practical to reduce invitation enumeration.
- Validate request Origin/CSRF protections for cookie-authenticated acceptance operations according to the actual deployment topology.
- Set appropriate no-store cache controls on token exchange and acceptance responses.

### Frontend/hosting responsibilities (future phase)

- Serve the acceptance page only over HTTPS.
- Set `Referrer-Policy: no-referrer`.
- Use a restrictive Content Security Policy; avoid third-party script execution on the acceptance page.
- Do not load analytics, pixels, advertising, chat widgets, or external resources on the token-handling page.
- Remove the fragment immediately after reading it.
- Do not persist or log the token.
- Ensure CDN, reverse-proxy, WAF, analytics, and hosting logs do not capture sensitive request bodies or cookies.
- Review browser history behavior and test URL cleanup on supported browsers.

## 7. Configuration

Proposed configuration (names are subject to alignment with the existing env schema):

```env
APP_BASE_URL=https://clickclickbuy.ng
STAFF_INVITATION_ACCEPTANCE_URL=https://clickclickbuy.ng/staff/accept-invitation
STAFF_INVITATION_ENCRYPTION_KEY=<32-byte-random-key-in-approved-encoding>
STAFF_INVITATION_TTL_HOURS=48
STAFF_INVITATION_ACCEPTANCE_SESSION_TTL_MINUTES=15
```

Notes:

- `APP_BASE_URL` already exists in the application configuration and is used by email infrastructure.
- `STAFF_INVITATION_ACCEPTANCE_URL` is proposed so the backend does not hardcode a frontend route. The final route is not confirmed until frontend implementation.
- `STAFF_INVITATION_ENCRYPTION_KEY` must be a separate production secret.
- The invitation default is configurable through `STAFF_INVITATION_TTL_HOURS` and defaults to 48 hours. The existing optional `expiresInDays` administrator override remains supported (1–30 days). Resend uses the configured hour-based default.
- Validate configuration at startup. Production must fail closed if required email/encryption configuration is missing or invalid when invitation email delivery is enabled.
- Never log secret values during configuration validation.

## 8. Database and transaction considerations

Review the current Prisma schema before deciding whether additional models/columns are needed.

Potential data requirements:
- Encrypted invitation token envelope associated with the email delivery record.
- Invitation identifier/version metadata sufficient to re-check current invitation state before send.
- Acceptance-session hash, invitation relation, expiry, consumed/revoked timestamps, and audit metadata.
- Unique/idempotency constraints preventing duplicate active session credentials or duplicate delivery scheduling for one invitation version.

Prefer reusing the existing email delivery table if it can represent this workflow safely. Do not store plaintext tokens in `templateData`. If a dedicated table or schema migration is needed, add it with a migration and PostgreSQL integration tests.

Invitation creation/resend and queue insertion must be atomic. Token rotation and suppression/invalidating prior deliveries must be designed so a rollback cannot leave an invitation without a deliverable email or leave an old token sendable.

## 9. API contract requirements

The backend API contract must support:

- Create invitation (authorized staff admin).
- Resend invitation (authorized staff admin).
- Revoke invitation (authorized staff admin).
- Exchange invitation token for a restricted acceptance session.
- Complete invitation acceptance using that session.
- Appropriate status/error responses for invalid, expired, revoked, already accepted, superseded, and rate-limited invitations.

The existing `POST /api/v1/staff-auth/accept-invitation` endpoint must be reviewed before changing its contract. Avoid breaking compatibility without updating tests and documenting the new exchange/acceptance sequence.

Admin responses must never include the raw invitation token once email delivery is active. Responses may include safe delivery state and invitation metadata.

## 10. Test and verification checklist

### Cryptography and configuration

- [ ] Token generation uses cryptographically secure randomness and sufficient entropy.
- [ ] Only token hashes are stored for invitation validation.
- [ ] AES-256-GCM encryption/decryption round-trip tests pass.
- [ ] Tampered ciphertext, nonce, tag, malformed envelope, and wrong key fail closed.
- [ ] Fresh nonce is generated for each encryption.
- [ ] Missing/invalid encryption key fails startup or disables invitation delivery safely according to explicit environment policy.
- [ ] Key versioning/rotation behavior is tested.

### Invitation lifecycle and email queue

- [ ] Invitation creation and email queue insertion are atomic.
- [ ] Admin create response does not expose raw token.
- [ ] Resend rotates token and queues a new encrypted delivery atomically.
- [ ] Previous queued/retrying delivery is suppressed after resend.
- [ ] Worker suppresses stale token deliveries after checking current invitation hash/status/expiry.
- [ ] Revoked, expired, accepted, and superseded invitations are never emailed by a retry.
- [ ] Provider retries do not create duplicate active invitations.
- [ ] Delivery failure and dead-letter operations do not expose token material.
- [ ] Existing Resend webhook and notification email tests remain green.

### Acceptance exchange and session

- [ ] Valid token exchanges only after explicit frontend action.
- [ ] Invalid, expired, revoked, accepted, and superseded tokens are rejected.
- [ ] Exchange is rate-limited and does not reveal sensitive token details.
- [ ] Session credential is random, stored hashed, invitation-scoped, and short-lived.
- [ ] Session cookie attributes are verified in integration/route tests.
- [ ] Session cannot access unrelated staff/customer endpoints.
- [ ] Resend/revocation/expiry invalidates previously issued acceptance sessions.
- [ ] Acceptance session is consumed exactly once.
- [ ] Concurrent acceptance attempts cannot create duplicate staff identities.
- [ ] CSRF/Origin protections are tested for the chosen deployment topology.

### Logging and HTTP security

- [ ] Token exchange request bodies are not logged.
- [ ] Token values and cookies are redacted from logs/traces/errors.
- [ ] Responses use no-store cache controls where appropriate.
- [ ] `Referrer-Policy: no-referrer` is applied where applicable.
- [ ] Production link generation uses HTTPS.
- [ ] Rate-limit behavior is covered.

### Regression

- [ ] Existing staff invitation lifecycle PostgreSQL tests pass.
- [ ] Existing invitation concurrency test passes.
- [ ] Existing role-delegation and authorization tests pass.
- [ ] Existing notification email provider/worker/webhook tests pass.
- [ ] TypeScript build passes.
- [ ] Full Vitest suite passes against `shop_db_test` only.
- [ ] No test or migration is run against the default `shop_db` database.

## 11. Implementation phases and progress tracker

Update this section as work is completed. Link relevant commits/PRs where possible.

### Phase 0 — Design and code review

- [x] Existing invitation and email infrastructure reviewed at a high level.
- [x] Security decisions and frontend/backend responsibilities recorded here.
- [ ] Reconfirm current local `dev` branch and working-tree status before code changes.
- [ ] Inspect current service/controller/schema/worker/test implementations before implementation.

### Phase 1 — Secure token encryption foundation

- [x] Add dedicated encryption configuration and validation.
- [x] Add versioned AES-256-GCM envelope utility.
- [ ] Add encryption/decryption and tamper-resistance tests (written; local execution pending).
- [ ] Document secret generation and deployment configuration.

### Phase 2 — Transactional invitation email queueing

- [x] Add invitation-specific email template.
- [x] Queue encrypted token delivery transactionally on create.
- [x] Queue encrypted token delivery transactionally on resend.
- [x] Suppress superseded queued deliveries.
- [x] Remove raw token from create/resend admin responses.
- [ ] Add PostgreSQL tests for transactionality and resend races (written; local execution pending).

### Phase 3 — Safe email worker integration

- [x] Add invitation-specific worker rendering/decryption path.
- [x] Re-check current invitation state/hash/expiry immediately before send.
- [x] Suppress stale, revoked, expired, accepted, and superseded deliveries.
- [ ] Verify retries, leases, dead-letter handling, and Resend webhooks (local verification pending).
- [ ] Add worker integration tests (written; local execution pending).

### Phase 4 — Acceptance-session backend

- [x] Design and implement token-exchange endpoint.
- [x] Add hashed, short-lived, invitation-scoped acceptance sessions.
- [x] Set secure cookie with deployment-appropriate attributes.
- [x] Implement session validation and one-time consumption.
- [x] Invalidate sessions on resend, revoke, and acceptance; expiry is enforced at lookup.
- [x] Add rate limiting, strict Origin validation, no-store responses, and safe errors.
- [x] Replace direct-token completion contract with exchange + session-cookie completion.
- [ ] Add concurrency and PostgreSQL integration tests (written; local execution pending).

### Phase 5 — Security hardening and backend verification

- [ ] Audit logs, tracing, errors, and request-body handling for token leakage.
- [ ] Verify HTTPS-only production URL generation.
- [ ] Verify security headers and cache controls.
- [ ] Run focused invitation/email/session tests.
- [ ] Run TypeScript build.
- [ ] Run full test suite against `shop_db_test`.
- [ ] Review diff for unrelated changes and secrets.
- [ ] Update this document with final behavior, configuration, API contract, and test evidence.

### Phase 6 — Frontend implementation (after backend completion)

- [ ] Confirm final frontend acceptance route.
- [ ] Read token from URL fragment.
- [ ] Remove fragment immediately with `history.replaceState`.
- [ ] Keep raw token in memory only.
- [ ] Require explicit user action before token exchange.
- [ ] Call backend exchange endpoint over HTTPS.
- [ ] Complete registration using the restricted acceptance session.
- [ ] Avoid third-party resources/analytics on acceptance page.
- [ ] Apply CSP and `Referrer-Policy: no-referrer` at frontend hosting.
- [ ] Verify CDN/proxy/browser logging does not capture token/session secrets.
- [ ] Test scanner prefetch behavior, browser history, resend, expiry, and replay.

## 12. Decisions and open questions

| Topic | Current decision / status |
|---|---|
| Product domain | `https://clickclickbuy.ng` |
| Frontend acceptance route | Proposed `/staff/accept-invitation`; not yet confirmed or built |
| Token in URL | Prefer fragment `#token=...`, not query parameter |
| Invitation token storage | SHA-256 hash only |
| Email queue token storage | AES-256-GCM encrypted envelope; never plaintext |
| Encryption secret | Dedicated `STAFF_INVITATION_ENCRYPTION_KEY` |
| Invitation TTL | 48 hours by default via `STAFF_INVITATION_TTL_HOURS`; admin override remains 1–30 days |
| Acceptance session | Opaque, hashed, invitation-scoped, one-time; default 15 minutes via `STAFF_INVITATION_ACCEPTANCE_SESSION_TTL_MINUTES` |
| Session transport | HttpOnly + Secure cookie; SameSite and scope depend on actual deployment origins |
| Email provider | Reuse existing Resend infrastructure |
| Email policy | Dedicated invitation email flow, not ordinary in-app notification |
| Frontend start | Immediately after backend completion |

Open questions to resolve during implementation:
- Confirm production frontend/API origin topology and choose the final `COOKIE_SAME_SITE` setting.
- Confirm frontend/API origin topology to determine cookie SameSite, domain, CORS, and CSRF configuration.
- The existing acceptance endpoint now completes through the restricted session cookie; frontend must adopt this contract.
- Confirm encryption key encoding and deployment secret-manager procedure.
- Confirm final frontend route when frontend work begins.

## 13. Definition of done

This feature is not complete until:
- Invitation email delivery is transactional and reliable.
- Raw invitation tokens are never persisted in plaintext or returned by admin endpoints.
- Old/resend-rotated/revoked/expired invitations cannot be delivered or accepted.
- Token exchange creates a short-lived, restricted session with safe cookie/CSRF behavior.
- Acceptance is single-use and concurrency-safe.
- Sensitive token/session values are not exposed through logs, URLs sent to servers, analytics, errors, or provider metadata.
- Focused tests, regression tests, TypeScript build, and full PostgreSQL test suite pass.
- Frontend integration requirements are documented and then verified when the frontend is built.
- This document's progress tracker and decisions reflect the actual shipped implementation.

## Implementation progress note (2026-11-14)

The feature branch `feat/staff-invitation-email-workflow` contains the first backend implementation pass: authenticated token encryption, transactional queue insertion using the existing email-delivery table, invitation-specific worker handling, fragment-based link generation, and restricted acceptance sessions. Tests have been added but have not yet been run against the local PostgreSQL test database. Do not treat this branch as verified until the focused tests and TypeScript build pass locally. The acceptance frontend route remains a configurable/proposed route and has not been built.


**Local verification status:** GitHub implementation commits are present, but the branch has not been built or tested locally. The checklists above distinguish implementation added from test execution still pending.


## Implementation update — 2026-11-14

The follow-up hardening changes are now present on PR #27:

- Acceptance URL validation is shared across environment validation, invitation queueing, and email rendering. Only HTTP/HTTPS are accepted outside production; production requires HTTPS. Credentials, query strings, and fragments are rejected.
- Invitation encryption now supports an active key ID and a keyring of historical keys. New queue payloads use the active key; old payloads continue decrypting while their key IDs remain configured. The legacy single-key setting maps to key ID `v1`.
- The invitation worker now holds a row lock on the invitation from final state/hash/recipient validation through provider acceptance and the delivery status update. Resend/revoke use the same invitation row lock, establishing a clear ordering between an in-flight send and a state change.
- Added unit coverage for URL schemes and key rotation, plus a PostgreSQL concurrency test for an in-flight send racing token rotation.

**Verification remains pending:** pull the latest PR branch and run the focused tests, TypeScript build, and full suite against `shop_db_test` only. The provider call is intentionally bounded by the Prisma transaction timeout; monitor provider latency and database lock duration in deployment.
