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
| Prisma model and migration | Implemented; local verification pending | Intended migration applied to `shop_db_test`; inspect the additional locally generated migration before cleanup. |
| Profile API | Implemented; build fix pushed | Controller now narrows optional validated fields before calling the service. |
| Deletion request and cancellation APIs | Implemented; local verification pending | Immediate deactivation and 30-day cancellation window. |
| Background deletion worker | Implemented; local verification pending | Hourly processing with seven-day operational deferrals. |
| Privacy-safe anonymization | Implemented; build fix pushed | Nullable JSON audit fields now use Prisma's `DbNull` sentinel. |
| Concurrency and idempotency safeguards | Implemented; local verification pending | Uses transaction boundaries and PostgreSQL advisory locks. |
| PostgreSQL integration tests | Added; execution pending | Focused test file is listed in local verification below. |
| Build and regression verification | Pending | Initial build exposed three TypeScript errors; fixes are now on the feature branch and must be pulled and rechecked. |

## Verification log

### Local run 1
- [x] `prisma format` completed.
- [x] `prisma validate` passed.
- [x] Intended account-deletion migration applied to `shop_db_test`.
- [x] Prisma Client generation completed.
- [ ] TypeScript build failed with three errors in the profile controller and audit JSON null handling.
- [ ] Focused integration tests were not run in this attempt.
- [ ] Full regression suite was not run.
- Note: while `prisma migrate dev` was prompting for a migration name, the next pasted test command was entered as the name. Prisma created and applied an unintended local migration named `20261114135922_npx_vitest_run_tests_customer_account_lifecycle_postgres_test_ts_pool_forks_max_workers_1`. Inspect this migration and the local Git status before deleting or resetting anything. Do not commit or push this accidental migration.

### Follow-up fixes pushed to the feature branch
- [x] Narrow validated profile update fields to satisfy TypeScript `exactOptionalPropertyTypes`.
- [x] Use `Prisma.DbNull` for nullable JSON audit fields.
- [ ] Pull the fixes and rerun the build.

## Acceptance criteria / release gates
- [ ] Prisma formatting and schema validation pass.
- [ ] Migration applies successfully to the dedicated test database without unintended schema changes.
- [ ] Prisma Client generation succeeds.
- [ ] TypeScript production build succeeds.
- [ ] Focused customer account lifecycle PostgreSQL tests pass.
- [ ] Full backend test suite passes.
- [ ] Diff whitespace check passes.
- [ ] Review confirms retained records, anonymized fields and dependent workflows behave as intended.
- [ ] Pull request is reviewed and explicitly approved before merge.

## Local verification

Use only `TEST_DATABASE_URL` pointing to the dedicated `shop_db_test` database. Do not run this migration or test workflow against `shop_db` or production.

From the backend directory, run each command separately. If `prisma migrate dev` prompts for a migration name, stop and inspect the reported schema difference; do not paste the next command into that prompt.

```bash
npx prisma format
npx prisma validate
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate status
npx prisma generate
npm run build
npx vitest run tests/customer-account-lifecycle-postgres.test.ts --pool=forks --maxWorkers=1
npx vitest run --pool=forks --maxWorkers=1
git diff --check origin/dev...HEAD
```

## Change tracking
- Feature branch: `feat/customer-profile-deactivation-deletion`
- Pull request: [#31 — Customer profile management and privacy-safe account deletion](https://github.com/Richardjames2023/my-devops-project/pull/31)
- Latest fix commits: `e892eab` (controller) and `923b963` (service).
- Current tracking state: implementation and the two build fixes are on the feature branch; local build, migration status review and tests remain pending.
- Update the checklists and workstream statuses in this document as local verification and review are completed.
- Keep this work on the feature branch until all release gates pass. Do not merge to `dev` before review and verification.
