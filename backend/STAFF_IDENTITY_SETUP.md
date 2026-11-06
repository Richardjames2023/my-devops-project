# Separate staff identity setup

This feature separates customer authentication (User / RefreshToken) from staff authentication (StaffAccount / StaffRefreshToken). A customer and a staff member may use the same email address because the two identity tables have independent unique constraints, credentials, and sessions.

## Apply the migration

Back up the database before applying this migration. It converts legacy non-customer role assignments into StaffAccount and StaffAccountRole records. Legacy staff accounts are created with PENDING_SETUP status and no staff password hash. Their previous password remains on the customer User only when that user already had the CUSTOMER role. Legacy staff-only User records are disabled as customer logins. Historical audit, return-inspection, and payment-reconciliation actors are moved to the staff actor columns. The temporary migration mapping is dropped; no permanent customer-to-staff identity link is retained.

From the backend directory:

```bash
npx prisma migrate dev
npx prisma generate
npx prisma db seed
```

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