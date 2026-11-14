# Customer Profile and Account Deletion

## Customer profile
- `PATCH /api/v1/customer/profile` — authenticated customer; updates first name, last name and/or phone. Phone uniqueness is enforced by the database.

## Account deletion lifecycle
- `POST /api/v1/customer/account/deletion-request` — authenticated customer; requires the current password. Deactivates the account immediately, increments the session version, revokes refresh tokens and schedules anonymization 30 days later.
- `POST /api/v1/customer/account/deletion-request/cancel` — public, rate-limited endpoint requiring the account email and password. Available only before the scheduled deadline; restores the account and requires a fresh login.
- A background worker checks due requests hourly. Requests with open orders, active inventory reservations, in-flight/failed deliveries, unresolved payments/refunds, returns or warranty claims are deferred by seven days and checked again.
- Completed financial records, order history, product reviews, return records, warranty records and audit actions are retained. Customer-facing identity becomes **Deleted Customer**; order contact and shipping PII is anonymized. Carts, wishlists, notification inbox/preferences, customer email deliveries, refresh tokens and verification/reset tokens are removed.
- Processing is transactionally locked per customer and can safely be retried. No user row is hard-deleted because retained business records depend on it.

## Local verification
Use only `TEST_DATABASE_URL` pointing to `shop_db_test`:
```bash
npx prisma format
npx prisma validate
npx prisma migrate dev
npx prisma generate
npm run build
npx vitest run tests/customer-account-lifecycle-postgres.test.ts --pool=forks --maxWorkers=1
```
