# Customer Profile and Account Deletion

## Purpose
Track the design decisions, implementation stages, verification and release readiness for customer profile management and privacy-safe account deletion.

## Design process and decision record

### 1. Requirements and scope
- [x] Allow customers to update their first name, last name and phone number.
- [x] Require password confirmation before an account-deletion request.
- [x] Deactivate the account immediately and invalidate existing authenticated sessions.
- [x] Provide a 30-day cancellation/restoration period.
- [x] Automatically process eligible deletion requests after the cancellation period.
- [x] Preserve legally and operationally necessary business records while anonymizing unnecessary personal data.
- [x] Make processing safe to retry and resilient to concurrent requests.

### 2. Agreed lifecycle decisions
| Area | Decision |
|---|---|
| Profile changes | Customers can update first name, last name and phone; duplicate phone numbers are rejected. |
| Deletion confirmation | The customer must provide their current password. |
| Immediate effect | Deactivate the account, increment the session version, revoke refresh tokens and consume outstanding verification/reset tokens. |
| Cancellation | Allow restoration only within 30 days of the original request. A fresh login is required after restoration. |
| Operational deferral | Defer processing by seven days when dependent orders, payments, refunds, reservations, deliveries, returns or warranty claims remain unresolved. Deferral must not extend the original 30-day cancellation deadline. |
| Historical records | Retain completed orders, payments, refunds, returns, warranties, reviews and necessary audit actions. |
| Identity and PII | Replace customer identity with “Deleted Customer”; anonymize order contact details and shipping information. |
| Personal data cleanup | Remove carts, wishlists, notification inbox/preferences/deliveries, refresh tokens and verification/reset tokens. |
| User record | Retain the user row in anonymized, inactive form to preserve historical foreign-key relationships. |

### 3. API and security design
- [x] `PATCH /api/v1/customer/profile` — authenticated profile update.
- [x] `POST /api/v1/customer/account/deletion-request` — authenticated, password-confirmed deletion request.
- [x] `POST /api/v1/customer/account/deletion-request/cancel` — public, rate-limited restoration using account email and password.
- [x] Invalidate active sessions and refresh tokens when deletion is requested.
- [x] Protect profile, request, cancellation and processing operations against concurrent updates with PostgreSQL advisory locks.
- [x] Serialize relevant login/refresh-token operations against account lifecycle changes.

### 4. Data model and processing design
- [x] Add a deletion-request lifecycle record with status, request/deadline timestamps, completion/cancellation timestamps and deferral metadata.
- [x] Process due requests in bounded batches through a background worker.
- [x] Defer requests while dependent business activity remains unresolved.
- [x] Perform anonymization and personal-data cleanup transactionally.
- [x] Keep processing idempotent so retries do not repeat destructive work or corrupt retained records.

### 5. Test design
- [x] Add PostgreSQL integration coverage for profile updates and duplicate phone protection.
- [x] Add coverage for password confirmation, immediate deactivation and session invalidation.
- [x] Add coverage for cancellation and the original 30-day deadline.
- [x] Add coverage for operational deferral, anonymization and retained order history.
- [x] Add coverage for concurrent duplicate requests and idempotent worker processing.
- [ ] Run the focused PostgreSQL integration test locally.
- [ ] Run the full backend regression suite locally.
- [ ] Resolve any failures and rerun the affected tests.

## Implementation status

| Workstream | Status | Notes |
|---|---|---|
| Requirements and lifecycle decisions | Complete | Scope and retention rules recorded above. |
| Prisma model and migration | Implemented; local verification pending | Migration adds the account-deletion lifecycle record. |
| Profile API | Implemented; local verification pending | Validation and duplicate-phone protection included. |
| Deletion request and cancellation APIs | Implemented; local verification pending | Immediate deactivation and 30-day cancellation window. |
| Background deletion worker | Implemented; local verification pending | Hourly processing with seven-day operational deferrals. |
| Privacy-safe anonymization | Implemented; local verification pending | Retains required business history and anonymizes customer PII. |
| Concurrency and idempotency safeguards | Implemented; local verification pending | Uses transaction boundaries and PostgreSQL advisory locks. |
| PostgreSQL integration tests | Added; execution pending | Focused test file is listed in local verification below. |
| Build and regression verification | Pending | Do not treat the feature as release-ready until checks pass. |

## Acceptance criteria / release gates
- [ ] Prisma formatting and schema validation pass.
- [ ] Migration applies successfully to the dedicated test database.
- [ ] Prisma client generation succeeds.
- [ ] TypeScript production build succeeds.
- [ ] Focused customer account lifecycle PostgreSQL tests pass.
- [ ] Full backend test suite passes.
- [ ] Diff whitespace check passes.
- [ ] Review confirms retained records, anonymized fields and dependent workflows behave as intended.
- [ ] Pull request is reviewed and explicitly approved before merge.

## Local verification

Use only `TEST_DATABASE_URL` pointing to the dedicated `shop_db_test` database. Do not run this migration or test workflow against `shop_db` or production.

From the backend directory:

```bash
npx prisma format
npx prisma validate
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate dev
npx prisma generate
npm run build
npx vitest run tests/customer-account-lifecycle-postgres.test.ts --pool=forks --maxWorkers=1
npx vitest run --pool=forks --maxWorkers=1
git diff --check origin/dev...HEAD
```

## Change tracking
- Feature branch: `feat/customer-profile-deactivation-deletion`
- Pull request: [#31 — Customer profile management and privacy-safe account deletion](https://github.com/Richardjames2023/my-devops-project/pull/31)
- Current tracking state: implementation has been added to the feature branch; local build, migration and test verification are still pending.
- Update the checklists and workstream statuses in this document as local verification and review are completed.
- Keep this work on the feature branch until all release gates pass. Do not merge to `dev` before review and verification.
