# Notification Delivery Policy

This document defines the notification channel policy enforced by the transactional outbox processor.

## Channel rules

| Event | In-app | Email | Notes |
|---|---|---|---|
| `order.created` for a registered customer | Preference-controlled (enabled by default) | No | Registered customers use the inbox |
| `order.created` for a guest | No inbox identity | Mandatory | Guest order confirmation is a transactional exception |
| `payment.succeeded` | Mandatory | Mandatory | Customer payment receipt |
| `payment.reconciliation_required` | Mandatory | Mandatory | Active staff with `payments.manage` |
| `delivery.delivered` | Preference-controlled (enabled by default) | No | Routine delivery update |
| `delivery.exception` | Mandatory | Mandatory | Customer and active staff with `deliveries.manage` |
| `return.requested` | Preference-controlled (enabled by default) | No | Customer and return managers |
| `return.received` | Preference-controlled (enabled by default) | No | Return managers |
| `warranty.claim.created` | Preference-controlled (enabled by default) | No | Customer and warranty managers |
| `inventory.low_stock` | Preference-controlled (enabled by default) | No | Inventory managers |
| `refund.needs_attention` | Mandatory | Mandatory | Active staff with `refunds.manage` |
| `staff.security_event` | Mandatory | Mandatory | Active staff with `staff.manage` or `audit_logs.read` |

## Preference enforcement

- Recipient preferences can disable routine in-app notifications.
- Recipient preferences cannot enable email for routine categories.
- Payment, security, and refund email notifications cannot be disabled.
- Event-level mandatory policies take precedence over category preferences.
- Legacy stored email preferences do not override the event policy.
- Already-queued routine outbox email deliveries are marked `SUPPRESSED` before the email worker claims them; direct transactional emails without an outbox recipient key are unaffected.
- Guest order confirmation and successful payment receipt are explicit transactional email exceptions.

## Staff invitations

Staff invitations remain a separate secure workflow. Invitation tokens must not be sent through ordinary notification templates or persisted in notification metadata. The invitation delivery integration must use the dedicated invitation flow and send only the one-time raw token to the trusted delivery adapter; only a token hash is persisted.

## Security event scope

The current staff security event producer publishes transactional events when staff roles or staff account status change. Failed login attempts, refresh-token replay detections, and other authentication anomalies are not yet wired to this event and remain follow-up work.

## Delivery exception scope

A delivery exception is published in the same database transaction when a delivery transitions into `FAILED`. A later retry that transitions the delivery into `FAILED` again is treated as a new exception occurrence.
