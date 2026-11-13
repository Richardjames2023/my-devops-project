# MVP Backend Feature Checklist

**Target branch:** `dev`  
**Tracking branch:** `docs/mvp-feature-checklist`  
**Purpose:** Track backend MVP capabilities through implementation, review, database migration (where applicable), and automated tests.

This checklist is an implementation tracker, not a claim that every item has already been fully audited. Mark an item complete only after its API/service behavior, authorization, persistence, failure handling, and relevant automated tests have been reviewed.

## Status legend

- [x] Implemented and verified in the current `dev` baseline (based on the review available when this checklist was created).
- [~] Foundation exists, but completion or end-to-end coverage needs verification.
- [ ] Outstanding / not yet verified as implemented.

---

## 1. Customer identity and access

- [x] Customer registration and authentication.
- [x] Customer account security and password reset.
- [x] Guest checkout and secure guest order access.
- [x] Staff identity, invitations, roles, and permission-based authorization.
- [ ] Confirm the full customer profile lifecycle and account deactivation/deletion requirements for MVP.

## 2. Product catalogue and administration

- [x] Public product and category browsing.
- [x] Product variants and product image management foundation.
- [~] Product/category/variant administration lifecycle: create, read, update, activate/deactivate, and lifecycle constraints.
  - Related work: [PR #16 — Product and Category Administration](https://github.com/Richardjames2023/my-devops-project/pull/16).
  - Verify whether this PR has been merged into `dev`; do not count its changes as complete until they are in the integration branch and tested.
- [ ] Confirm product search, filtering, sorting, and pagination meet storefront requirements.
- [ ] Confirm product image replacement/removal and cleanup behavior are covered by tests.

## 3. Cart, checkout, orders, and payments

- [x] Customer cart foundation.
- [x] Guest and authenticated checkout.
- [x] Server-side pricing and order creation.
- [x] Inventory reservation during checkout.
- [x] Paystack payment initialization and verification.
- [x] Payment webhook processing, idempotency, and recovery/reconciliation.
- [x] Customer order history and order access.
- [ ] Staff order-management API:
  - [ ] List and paginate all orders.
  - [ ] Filter/search by order number, customer, date range, payment state, and order state.
  - [ ] Retrieve full order details, line items, shipping details, payment information, and operational history.
  - [ ] Enforce staff permissions and prevent unauthorized access to customer data.
- [ ] Review order status transitions and cancellation/refund edge cases end-to-end.

**Payment-provider scope decision:** Paystack remains the only payment provider for this MVP. Multiple payment providers are explicitly out of scope for the MVP; do not add another gateway as part of this checklist.

## 4. Inventory and warehouse operations

- [x] Inventory records and stock movement foundation.
- [x] Stock reservation and reservation expiry.
- [x] Stock deduction/finalization after successful payment.
- [x] Package allocation foundation and over-allocation protections.
- [~] Stock movement types include adjustment validation, but the service currently indicates that adjustments require a separate operation.
- [ ] Implement audited stock adjustments:
  - [ ] Authorized staff can increase or decrease available stock.
  - [ ] Require a reason/reference for each adjustment.
  - [ ] Record actor, timestamp, before/after quantities, and movement history.
  - [ ] Apply changes transactionally and safely under concurrent requests.
  - [ ] Add PostgreSQL integration tests for authorization, validation, concurrency, and audit records.

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

- [~] Customer wishlist implementation is on `feat/customer-wishlist`; pending local migration, build, and test validation before merge.
  - [x] Authenticated customers can add and remove products.
  - [x] Customers can view saved products with image, variants, and current availability/status.
  - [x] Prevent duplicate entries for the same customer/product with a database unique constraint and idempotent upsert.
  - [x] Validate product existence and allow only active products to be newly added.
  - [x] Retain previously saved products if later deactivated or unavailable and expose their current status.
  - [x] Enforce customer ownership; guest and staff identities are excluded.
  - [x] Add database migration, request validation, route tests, PostgreSQL integration tests, and API documentation.
  - [ ] Merge to `dev` after local validation.
- [ ] Decide whether moving a wishlist item into the cart is required for the first MVP release. If included, it must use the existing cart validation and pricing rules.

## 7. Coupons and discounts

- [x] Coupon creation, listing, detail, and update foundation.
- [x] Percentage and fixed discounts, minimum subtotal, maximum discount, validity, and usage limits.
- [x] Coupon reservation and redemption tied to verified payment.
- [x] Coupon release on applicable cancellation/failure paths.
- [x] Discount snapshots and calculation tests.
- [ ] Verify staff-facing coupon lifecycle and reporting requirements against the final admin UI.

## 8. Returns, refunds, and warranties

- [x] Return request and inspection workflow foundation.
- [x] Refund processing and reconciliation foundation.
- [x] Warranty claim workflow foundation.
- [~] Guest after-sales access is being implemented using the existing guest order access token; registered-customer workflows remain unchanged.
  - [x] Decide to include guest returns and warranty claims in MVP.
  - [~] Add token-scoped guest return creation/history/detail and warranty claim submission/history/detail.
  - [~] Add token expiry and explicit revocation, shared token hashing, and rate limits.
  - [ ] Add guest return evidence upload and secure evidence viewing.
  - [ ] Run PostgreSQL integration tests, migration validation, build, and full suite before merge.
- [ ] Verify end-to-end stock restoration, refund state, audit trail, and customer notifications for all return/refund outcomes.

## 9. Reviews and customer engagement

- [x] Product review submission and moderation foundation.
- [ ] Customer wishlist (tracked in section 6).
- [ ] Confirm product review eligibility, duplicate-review rules, moderation, and public visibility behavior are fully covered by tests.

## 10. Notifications and email

- [x] Notification persistence and inbox APIs.
- [x] Transactional outbox foundation and processing worker.
- [x] Email delivery worker and retry foundation.
- [~] Business event publishing across orders, payments, delivery, returns, refunds, warranties, inventory, and staff security is being completed through a producer-to-inbox/email audit.
  - [~] Transactional outbox and event-level email policy distinguish routine notifications from mandatory transactional/urgent email; local validation pending.
  - [~] Guest order confirmations remain email-only transactional exceptions because guests have no inbox identity; local validation pending.
  - [~] Successful payment receipts remain mandatory in-app and email; local validation pending.
  - [~] Routine order, delivery-completed, return, warranty, and low-stock events cannot be opted into email through recipient preferences; local validation pending.
  - [~] Already-queued routine outbox emails are suppressed before the email worker claims them; local validation pending.
  - [~] Delivery status transitions into FAILED publish a transactional delivery-exception event; local validation pending.
  - [~] Staff role/status changes publish transactional security events; local validation pending.
  - [ ] Verify delivery-exception and staff-security events fan out to the intended recipients with mandatory email.
  - [ ] Add/verify PostgreSQL coverage for delivery-exception and staff-security fan-out, including recipient permissions and retries.
- [~] Align notification channels with the agreed policy:
  - Routine events: in-app only (subject to in-app preferences).
  - Urgent/actionable events: in-app and email, mandatory.
  - Guest order confirmation and successful payment receipt: explicit transactional email exceptions.
  - Staff invitations: dedicated secure invitation email flow, separate from ordinary notifications.
- [ ] Verify the dedicated staff invitation email adapter actually sends and tracks invitations end-to-end.
- [ ] Test retries, dead-letter/manual-review paths, duplicate events, and recovery.

## 11. Platform operations, security, and release readiness

- [x] Health and database readiness checks.
- [x] Environment validation foundation.
- [x] Prisma migrations and generated client workflow.
- [~] Verify production secrets, webhook secrets, courier credentials, and coupon HMAC secret are configured securely in deployment environments.
- [ ] Verify rate limits and abuse protections for authentication, guest order access, checkout, wishlist, reviews, and public endpoints.
- [ ] Verify structured logging, correlation/request IDs, and actionable error reporting across background workers and external integrations.
- [ ] Verify backup/restore procedure and production migration/rollback runbook.
- [ ] Run full build and test suite against the dedicated test database before each merge; never point integration tests at production.

---

## MVP scope decisions

| Capability | MVP decision |
|---|---|
| Paystack | Include; current payment provider |
| Multiple payment providers | Exclude from MVP |
| External courier integration | On hold pending logistics partner selection; retain manual delivery workflow |
| Customer wishlist | Include |
| Guest returns/warranty claims | Include; guest order access token required |
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

**Testing safety:** PostgreSQL integration tests must use the dedicated `shop_db_test` database, never a development or production database.
