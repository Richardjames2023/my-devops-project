# Guest after-sales access

Guest checkout already issues a cryptographically random order access token and stores only its SHA-256 hash. The same token now authorizes guest return and warranty workflows without creating a customer account.

## Authentication

Send the raw token in the `X-Guest-Order-Token` header. The token is returned once by `POST /api/v1/orders/guest`; clients must retain it securely and must not put it in URLs or logs.

The token remains valid for at least 24 months, or until three months after the longest warranty duration on the order, whichever is later. Existing guest tokens are backfilled by the migration. A guest can revoke access with:

`POST /api/v1/orders/guest/:orderId/access/revoke`

Revocation invalidates guest order retrieval, delivery tracking, return, and warranty endpoints.

## Guest return endpoints

- `POST /api/v1/returns/guest/:orderId` — create a return request. The order ID is taken from the route, not trusted from the request body.
- `GET /api/v1/returns/guest/:orderId` — list return requests for that order.
- `GET /api/v1/returns/guest/:orderId/:returnRequestId` — retrieve one return request.

The existing seven-day return window, delivered-package checks, and per-order-item quantity reservations continue to apply.

## Guest warranty endpoints

- `POST /api/v1/warranty-claims/guest/:orderId` — submit a warranty claim for an order item.
- `GET /api/v1/warranty-claims/guest/:orderId` — list warranty claims for that order.
- `GET /api/v1/warranty-claims/guest/:orderId/:claimId` — retrieve one warranty claim.

The order item must belong to the token-authorized guest order. Existing warranty snapshot, active-period, and quantity rules continue to apply.

## Security notes

- Token hashes are compared server-side; raw tokens are never persisted.
- Guest access is restricted to orders with no registered `userId`.
- Wrong-order and invalid-token lookups return not-found responses to avoid leaking resource ownership.
- Guest write and read endpoints use the existing guest checkout/retrieval rate limiters.
- The revocation timestamp is retained for auditability; the token hash is not cleared.
- Guest return evidence upload/viewing is not included in this implementation slice and remains a tracked follow-up.
