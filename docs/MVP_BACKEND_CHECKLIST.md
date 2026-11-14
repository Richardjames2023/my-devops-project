# MVP Backend Feature Checklist

**Target branch:** `dev`  
**Tracking branch:** `docs/reconcile-mvp-backend-checklist`  
**Last reconciled against:** `dev` at `9955efceb0cd3c5bf0385007ae2764ac8b2a540c` (14 November 2026)  
**Purpose:** Track backend MVP capabilities through implementation, review, database migration (where applicable), and automated tests.

This checklist is an implementation tracker, not a claim that every item has already been fully audited. Mark an item complete only after its API/service behavior, authorization, persistence, failure handling, and relevant automated tests have been reviewed.

## Status legend

- [x] Implemented on `dev` and supported by current code/tests reviewed during this reconciliation.
- [~] Implemented or partially covered, but an explicit scope, deployment, or end-to-end verification remains.
- [ ] Outstanding / not yet verified as implemented.

---

## 1. Customer identity and access

- [x] Customer registration and authentication.
- [x] Customer account security and password reset.
- [x] Guest checkout and secure guest order access.
- [x] Staff identity, invitations, roles, and permission-based authorization.
- [ ] Confirm the full customer profile lifecycle and account deactivation/deletion requirements for MVP.
- [x] Backend staff invitation email delivery, encrypted token queueing, and restricted acceptance-session exchange/completion are implemented and covered by tests (PR #27).
- [ ] Implement the frontend invitation acceptance page: read and remove the URL fragment safely, require an explicit user action to exchange the token, then complete acceptance using the HttpOnly session cookie.
- [ ] Confirm production frontend/API origin topology and configure cookie SameSite/CORS settings accordingly before deployment.

## 2. Product catalogue and administration

- [x] Public product and category browsing.
- [x] Product variants and product image management, including protected upload, metadata update, primary-image selection, deletion, and Cloudinary cleanup handling (PR #17).
- [x] Product/category/variant administration lifecycle: create, read, update, activate/deactivate, and lifecycle constraints (PR #16).
- [x] Product search, filtering, sorting, price-range filtering, and pagination are covered by catalog route/service tests.
- [x] Product image replacement/removal and cleanup behavior have route, service, and cleanup-worker regression coverage.
- [~] Review catalogue behavior against final storefront UX requirements (for example, exact filter combinations and expected pagination defaults).

## 3. Cart, checkout, orders, and payments

- [x] Customer cart foundation.
- [x] Guest and authenticated checkout.
- [x] Server-side pricing and order creation.
- [x] Inventory reservation during checkout.
- [x] Paystack payment initialization and verification.
- [x] Payment webhook processing, idempotency, and recovery/reconciliation.
- [x] Customer order history and order access.
- [x] Staff order-management API (PR #20):
  - [x] List and paginate all orders.
  - [x] Filter/search by order number, customer, date range, payment state, and order state.
  - [x] Retrieve order details, line items, shipping details, payment information, and operational history.
  - [x] Enforce authentication and `orders.read` permission.
- [~] Review order status transitions and cancellation/refund edge cases end-to-end across payment, inventory, returns, and staff operations.

**Payment-provider scope decision:** Paystack remains the only payment provider for this MVP. Multiple payment providers are explicitly out of scope for the MVP; do not add another gateway as part of this checklist.

## 4. Inventory and warehouse operations

- [x] Inventory records and stock movement foundation.
- [x] Stock reservation and reservation expiry.
- [x] Stock deduction/finalization after successful payment.
- [x] Package allocation foundation and over-allocation protections.
- [x] Audited stock adjustments (PR #21):
  - [x] Authorized staff can increase or decrease available stock using `inventory.manage`.
  - [x] Require a meaningful reason and positive whole-number quantity; optional reference/notes are supported.
  - [x] Record actor, timestamp, before/after quantities, stock movement, and audit history.
  - [x] Apply changes transactionally with inventory-row locking and prevent decreases below reserved/quarantined stock.
  - [x] PostgreSQL tests cover authorization, validation, audit records, and concurrent deductions.

## 5. Fulfillment and external courier integration

- [x] Fulfillment-ready order workflow foundation.
- [x] Package allocation.
- [x] Delivery assignment and delivery status workflow.
- [x] Delivery zones and delivery-fee calculation.
- [x] Delivery completion and delivery exception workflow foundation.
- [~] External courier integration is on hold pending business selection of logistics partner(s). The existing manual delivery assignment/status workflow remains available; do not begin provider-specific implementation yet.
  - [ ] Select the initial courier provider(s) and confirm API/credential requirements.
  - [ ] After provider selection, define a provider-neutral internal delivery/shipment contract and implement the selected adapter.
  - [ ] After provider selection, implement shipment/waybill creation, verified status updates, idempotency, retries, and provider adapter tests.
- [ ] Decide whether courier rate quoting and booking should be automated at checkout or initiated by staff after fulfillment, after a provider is selected.

## 6. Customer wishlist

- [x] Customer wishlist is merged into `dev` (PR #22) and has migration, route, and PostgreSQL test coverage.
  - [x] Authenticated customers can add and remove products.
  - [x] Customers can view saved products with image, variants, and current availability/status.
  - [x] Prevent duplicate entries for the same customer/product with a database unique constraint and idempotent upsert.
  - [x] Validate product existence and allow only active products to be newly added.
  - [x] Retain previously saved products if later deactivated or unavailable and expose their current status.
  - [x] Enforce customer ownership; guest and staff identities are excluded.
- [ ] Decide whether moving a wishlist item into the cart is required for the first MVP release. If included, it must use the existing cart validation and pricing rules.

## 7. Coupons and discounts

- [x] Coupon creation, listing, detail, and update foundation.
- [x] Percentage and fixed discounts, minimum subtotal, maximum discount, validity, and usage limits.
- [x] Coupon reservation and redemption tied to verified payment.
- [x] Coupon release on applicable cancellation/failure paths.
- [x] Discount snapshots and calculation tests.
- [~] Verify staff-facing coupon lifecycle and reporting requirements against the final admin UI.
- [~] Complete the remaining coupon hardening review: production HMAC secret provisioning and regression coverage for fixed discounts, maximum caps, minimum subtotals, and concurrent use of the final coupon slot.

## 8. Returns, refunds, and warranties

- [x] Return request and inspection workflow foundation.
- [x] Refund processing and reconciliation foundation.
- [x] Warranty claim workflow foundation.
- [x] Guest after-sales access is merged into `dev` (PR #24), using the existing guest order access token; registered-customer workflows remain unchanged.
  - [x] Guest return creation, history, and detail endpoints are token-scoped.
  - [x] Guest warranty claim submission, history, and detail endpoints are token-scoped.
  - [x] Guest token hashing, expiry, explicit revocation, and rate limiting are implemented.
  - [x] Guest token validity is enforced across guest order retrieval, delivery tracking, payment initialization/verification, returns, and warranty claims.
  - [x] PostgreSQL and HTTP coverage exists for guest access, token expiry/revocation, and guest return/warranty routes.
- [ ] Add guest-specific return evidence upload and secure evidence viewing. Existing evidence upload/view controllers require authenticated users; guest-token authorization is not established by those controllers.
- [~] Verify end-to-end stock restoration, refund state, audit trail, and customer notifications for every return/refund outcome; relevant reconciliation and business-event tests exist, but the complete cross-module outcome matrix still needs review.

## 9. Reviews and customer engagement

- [x] Product review submission and moderation foundation.
- [x] Review eligibility requires a paid, fully delivered order; unapproved reviews remain private (PostgreSQL coverage exists).
- [~] Verify duplicate-review prevention and the complete moderation/public-visibility lifecycle.
- [x] Customer wishlist (tracked in section 6).

## 10. Notifications and email

- [x] Notification persistence and inbox APIs.
- [x] Transactional outbox foundation and processing worker.
- [x] Email delivery worker, provider integration, retries, and dead-letter handling.
- [x] Business event fan-out is covered for orders, successful payments, payment reconciliation, delivery exceptions, returns, refunds, warranties, low stock, and staff role/status security events.
- [x] Event-level email policy enforces routine in-app-only notifications and mandatory email for urgent/actionable events.
- [x] Guest order confirmation and guest payment events are handled without creating fake customer inbox identities; guest order confirmation remains a transactional email exception.
- [x] Successful payment receipts remain mandatory transactional notifications.
- [x] Already-queued routine emails are suppressed before delivery; expired processing leases are not incorrectly reclaimed.
- [x] Delivery status transitions into FAILED publish transactional delivery-exception events to customers and authorized delivery managers.
- [x] Staff role/status changes publish transactional security events to active staff with the required permissions.
- [x] Dedicated staff invitation email flow is implemented separately from ordinary notifications; encrypted queueing, stale-token suppression, resend/revoke concurrency, and provider acceptance are covered by tests (PR #27).
- [x] PostgreSQL tests cover recipient fan-out, permissions, retry/backoff, dead-letter handling, duplicate processing, and worker concurrency.
- [~] Extend the staff-security event scope if the business requires failed-login and refresh-token-replay alerts; current producer coverage is for staff role and account-status changes.

## 11. Platform operations, security, and release readiness

- [x] Health and database readiness checks.
- [x] Environment validation foundation, including production credential-format validation.
- [x] Prisma migrations and generated client workflow.
- [~] Verify actual production secrets, webhook secrets, courier credentials, and coupon HMAC secret are configured securely in deployment environments. Repository code cannot prove deployment secret values.
- [~] Complete a rate-limit and abuse-protection audit across authentication, guest order access, checkout, wishlist, reviews, and public endpoints.
- [ ] Verify structured logging, correlation/request IDs, and actionable error reporting across background workers and external integrations.
- [ ] Verify backup/restore procedure and production migration/rollback runbook.
- [x] Run full build and test suite against the dedicated test database before the latest merge: TypeScript build passed; full Vitest suite passed (69 files, 423 tests). Prisma migration status was up to date on `shop_db_test`.
- [ ] Repeat build, migration validation, and full test suite against `shop_db_test` before each subsequent merge; never point integration tests at `shop_db` or production.

## MVP scope decisions

| Capability | MVP decision |
|---|---|
| Paystack | Include; current payment provider |
| Multiple payment providers | Exclude from MVP |
| External courier integration | On hold pending logistics partner selection; retain manual delivery workflow |
| Customer wishlist | Include; merged and tested on `dev` |
| Guest returns/warranty claims | Include; token-scoped API merged; guest evidence upload/view remains outstanding |
| Automated courier rate quoting at checkout | Decision required |
| Move wishlist item to cart | Decision required |

## Definition of done

A checklist item may be marked `[x]` only when:

1. The implementation is merged into `dev`.
2. Input validation and authorization are covered.
3. Persistence and transaction/concurrency behavior are covered where relevant.
4. Failure, retry, and idempotency behavior are handled where relevant.
5. Unit and/or PostgreSQL integration tests pass.
6. `npx prisma validate`, `npm run build`, and the full Vitest suite pass when applicable.
7. Required environment variables, migrations, and deployment notes are documented.

**Reconciliation note:** This update was prepared from the current `dev` tree, merged PR records, implementation files, and test cases. Items marked `[~]` or `[ ]` are intentionally not treated as complete merely because related code exists.

**Testing safety:** PostgreSQL integration tests must use the dedicated `shop_db_test` database, never a development or production database.
