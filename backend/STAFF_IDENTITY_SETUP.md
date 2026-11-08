# Separate staff identity setup

This feature separates customer authentication (User / RefreshToken) from staff authentication (StaffAccount / StaffRefreshToken). A customer and a staff member may use the same email address because the two identity tables have independent unique constraints, credentials, and sessions.

## Apply the migrations safely

Back up the database before applying these migrations.

The staff identity migration converts legacy non-customer role assignments into StaffAccount and StaffAccountRole records. Legacy staff accounts are created with PENDING_SETUP status and no staff password hash. Their previous password remains on the customer User only when that user already had the CUSTOMER role. Legacy staff-only User records are disabled as customer logins. Historical audit, return-inspection, and payment-reconciliation actors are moved to the staff actor columns. The temporary migration mapping is dropped; no permanent customer-to-staff identity link is retained.

### 1. Preflight legacy staff email addresses

Before the first application of `20261106230000_separate_staff_identity` to a database, run the preflight script. It checks only legacy users who have at least one non-CUSTOMER role and blocks migration if two or more addresses would become identical after trimming surrounding whitespace and converting to lowercase, or if an address becomes blank.

From the backend directory, make the configured local environment variables available to the shell and run:

```bash
set -a
source .env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/preflight-staff-identity-emails.sql
```

In production, provide `DATABASE_URL` through the deployment secret manager rather than copying credentials into a command or committing them.

If the preflight fails, inspect the reported legacy user IDs and email addresses and resolve the records manually before proceeding. Do not automatically merge staff identities: determine which account and role assignments should be retained, then rerun the preflight.

If the original staff identity migration has already been applied to a database, the legacy `user_roles` records have already been transformed. Do not expect the legacy preflight to find those original records on that database. The follow-up normalization migration independently checks the resulting `staff_accounts` table and aborts safely if collisions remain.

### 2. Apply migrations

For local development:

```bash
npx prisma migrate dev
npx prisma generate
npx prisma db seed
```

For staging and production deployments, after taking a backup and passing the preflight on databases that have not yet received the staff identity migration:

```bash
npx prisma migrate deploy
npx prisma generate
```

Run the seed as a separately controlled deployment step if the target database still needs the application roles and permissions. Do not use `prisma migrate dev` against production.

The follow-up migration `20261107130000_normalize_staff_account_emails` normalizes existing staff account email addresses and adds a database check constraint so future direct database writes cannot store non-canonical values. It stops rather than silently merging records if normalized duplicates or blank addresses are present. If it fails at this duplicate guard, resolve the reported records manually, confirm that no migration changes were applied, then mark that failed attempt rolled back with `npx prisma migrate resolve --rolled-back 20261107130000_normalize_staff_account_emails` before retrying `npx prisma migrate dev` locally or `npx prisma migrate deploy` in deployment. For any failure other than the initial duplicate guard, inspect the database and Prisma migration state before using `migrate resolve`.

Application code also normalizes staff invitation and login email input by trimming surrounding whitespace and converting to lowercase. Customer and staff identities remain independent; the same canonical email may exist once in each identity table.

## Bootstrap the first business owner

The seed creates roles and permissions only. It no longer creates a user with a hard-coded owner password.

Set these environment variables securely for the one-time bootstrap:

- INITIAL_STAFF_OWNER_EMAIL
- INITIAL_STAFF_OWNER_PASSWORD (minimum 16 characters; use a generated secret)
- INITIAL_STAFF_OWNER_FIRST_NAME
- INITIAL_STAFF_OWNER_LAST_NAME

Then run:

```bash
npm run staff:bootstrap
```

The bootstrap command refuses to run if an active staff account already exists or if the email already belongs to a staff account. Do not commit these environment values.

## Staff API

All staff administration routes require a staff access token and current database permissions.

- POST /api/v1/staff/invitations — create an invitation with one or more role IDs.
- GET /api/v1/staff/roles — list assignable staff roles.
- GET /api/v1/staff/invitations — list invitations and expire stale pending records.
- PATCH /api/v1/staff/invitations/:invitationId/roles — edit roles before acceptance.
- POST /api/v1/staff/invitations/:invitationId/resend — rotate the single-use invitation token and extend expiry.
- DELETE /api/v1/staff/invitations/:invitationId — revoke a pending invitation.
- POST /api/v1/staff-auth/accept-invitation — accept an invitation and set an independent staff password.
- POST /api/v1/staff-auth/login and POST /api/v1/staff-auth/refresh — staff-only session endpoints.
- GET /api/v1/staff/accounts — list staff accounts.
- PATCH /api/v1/staff/accounts/:staffId/roles — replace a staff member's role set.
- PATCH /api/v1/staff/accounts/:staffId/status — activate, suspend, or deactivate an established account.

Invitations default to seven days and may be configured from one to 30 days. The invitee cannot select or modify roles. The inviter can only delegate roles whose permissions they hold; only a current BUSINESS_OWNER can delegate BUSINESS_OWNER. The last active business owner cannot be demoted, suspended, or deactivated.

## Invitation delivery

The backend generates a cryptographically random token and stores only its SHA-256 hash. The create and resend endpoints return the raw token once to the trusted admin client. Automatic email delivery is not wired yet because this repository does not currently configure a backend email provider. The admin client must deliver the token through an approved email channel; do not log it, persist it in browser storage, or expose it to other staff. Once the email provider is selected, connect it to these invitation events.

## Authorization behavior

Access tokens include an explicit identityType claim. Legacy tokens without the claim are treated as customer tokens only. Customer-only routes reject staff identities; staff permission middleware rejects customer identities and reloads current staff roles and permissions from PostgreSQL on each protected request, so role revocation and account suspension take effect immediately.

## Refresh-token session security

Customer and staff refresh tokens are stored as hashes and grouped into independent session families. Each successful login creates a new family; rotating a token preserves that family identifier.

If a previously consumed refresh token is presented again, the backend treats it as possible token theft and revokes every still-active refresh token in that family. Other login sessions for the same customer or staff account remain valid. Rotations and replay revocations are serialized with PostgreSQL transaction-scoped advisory locks per family, including across application workers. A concurrent attempt to consume the same token follows the same strict policy: the winning rotation may be created, but the losing request detects the consumed token and revokes the family.

Existing refresh-token records receive independent family IDs during migration because their historical rotation relationships cannot be reconstructed. Users do not need to log in again solely because this migration runs.

Clients should serialize refresh requests per session and, after a refresh request returns an authentication failure, discard the refresh token for that session and require a new login. Do not automatically retry a refresh token after an ambiguous network failure: the server may already have consumed it.

## Notification persistence foundation

The notification foundation migration creates durable storage for future in-app and email delivery. It does not yet publish business events, send email, run workers, or expose notification APIs.

The persistence layer contains:

- `notification_outbox`: idempotent business-event records with availability, processing lease, attempt count, and terminal status fields. Business transactions will write these records in the same database transaction as the state change they describe.
- `notifications`: identity-owned in-app inbox entries. Each row belongs to exactly one customer `User` or one `StaffAccount`; the database enforces this with a check constraint. Partial unique indexes prevent the same outbox event from creating duplicate inbox entries for the same recipient.
- `notification_email_deliveries`: one durable email-delivery record per in-app notification, including a recipient-address snapshot, template key/data, retry scheduling, lease fields, and provider acceptance metadata. `ACCEPTED` means the provider accepted the request; it does not mean the message reached the recipient's inbox.
- `notification_preferences`: category preferences scoped independently to a customer or staff identity. The database prevents a preference from belonging to both identity types and partial unique indexes enforce one preference per identity/category.

Customer and staff notification ownership is deliberately separate even when both identities share the same email address. The recipient identity, not the email address, determines inbox ownership and preference scope.

The first-release channel policy is enforced by application logic in a later phase: customer transactional events use in-app and email; staff events use in-app, with email reserved for urgent/actionable events. Mandatory transactional and security notices must not be disabled by user preferences. Staff invitations remain a separate secure delivery flow; raw invitation tokens must never be placed in generic outbox payloads or notification metadata.

The outbox and email-delivery tables include database lease fields and indexes to support multiple workers using PostgreSQL row locking and stale-lease recovery. Worker claim/acknowledgement behavior, retry policy, event publishers, recipient resolution, APIs, and email provider integration are intentionally deferred to later implementation phases.

Apply the migration with the same environment-specific commands described above:

- Local development: `npx prisma migrate dev` followed by `npx prisma generate`.
- Staging/production: `npx prisma migrate deploy` followed by `npx prisma generate`.

Back up the database before applying migrations. Do not use `prisma migrate dev` in production.

## Notification event publishing

Phase 2 introduces a transaction-scoped notification outbox publisher at `src/modules/notifications/notification-outbox.publisher.ts`. Domain services pass their existing Prisma transaction client to the publisher; it does not open a separate transaction, call an email provider, or perform network I/O.

The publisher uses a deterministic event key (`v1:<eventType>:<aggregateType>:<aggregateId>`) and an idempotent upsert. Repeated publication of the same event/aggregate leaves the first event payload unchanged. Event payloads currently contain identifiers and transaction snapshots only; they must not contain passwords, access tokens, refresh tokens, invitation tokens, or other credentials.

The first integrated events are:

- `payment.succeeded`: committed with successful payment, inventory finalization, and order confirmation.
- `payment.reconciliation_required`: committed with the verified successful payment and its inventory-reconciliation record, for later urgent staff routing.
- `delivery.delivered`: committed with delivery/package/fulfillment/order completion updates, and emitted only on the transition into DELIVERED.

These events are durable records only. Recipient resolution, notification fan-out, email policy enforcement, retries, workers, and APIs remain later phases. Guest orders currently have no customer identity row for an in-app notification; the later recipient-routing phase must explicitly handle guest email delivery rather than inventing a customer inbox identity.
