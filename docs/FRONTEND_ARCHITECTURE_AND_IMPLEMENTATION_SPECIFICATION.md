# MY-DEVOPS-PROJECT
# Frontend Architecture & Implementation Specification

**Document type:** Frontend Architecture, Technical Design & Delivery Specification  
**Version:** 1.0  
**Date:** 21 November 2026  
**Project:** `my-devops-project`  
**Backend status:** Backend implementation phase completed; frontend not yet started  
**Document status:** Proposed architecture and implementation baseline  
**Audience:** Frontend developers, backend developers, QA engineers, technical reviewers and project stakeholders

---

# 1. Executive Summary

## 1.1 Purpose

This document establishes the technical, architectural, functional, security and quality standards for building the frontend of `my-devops-project`.

The objective is to deliver a production-grade commerce experience that integrates with the existing Node.js, TypeScript, Express, Prisma and PostgreSQL backend.

The frontend must provide two distinct experiences:

1. **Customer storefront:** A responsive commerce application through which customers can discover products, manage accounts, purchase products, make payments, track orders and access after-sales services.
2. **Staff administration:** A secure management application through which authorized staff can manage commerce operations, customers, products, inventory, orders, deliveries, notifications, analytics and customer support.

Both applications will consume the existing backend APIs. They must not independently implement business rules that already belong to the backend.

## 1.2 Product objectives

The frontend must:

- Deliver a professional, intuitive and responsive shopping experience.
- Expose the backend's existing commerce capabilities through well-designed interfaces.
- Support registered customers and eligible guest workflows.
- Provide secure staff operations based on backend permissions.
- Integrate Paystack payment initialization and verification flows.
- Provide reliable order, inventory and delivery visibility.
- Support customer returns, refunds and warranty workflows.
- Integrate notifications and real-time customer support.
- Present AI chatbot and human-support functionality.
- Provide actionable administrative reporting.
- Meet production expectations for security, accessibility, reliability, performance and maintainability.

## 1.3 Architectural principles

The following principles are mandatory:

1. The backend remains the source of truth.
2. The frontend never calculates authoritative order totals.
3. Authorization is enforced by the backend, not merely by hiding interface elements.
4. Customer and staff experiences are separated.
5. API contracts are centralized and consistently typed.
6. Sensitive operations require explicit user confirmation.
7. All asynchronous operations have appropriate loading, success, empty and error states.
8. Customer-facing interfaces must work on mobile, tablet and desktop.
9. Critical business operations must be observable and testable.
10. No feature should be marked complete solely because its interface has been implemented.

---

# 2. Existing Backend Context

## 2.1 Technology foundation

The existing backend uses:

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| API framework | Express 5 |
| ORM | Prisma |
| Database | PostgreSQL |
| Validation | Zod |
| Testing | Vitest |
| Payment provider | Paystack |
| Image/media infrastructure | Cloudinary |
| API version prefix | `/api/v1` |

The frontend must integrate with this infrastructure rather than introduce competing business services.

## 2.2 Existing backend business capabilities

The frontend architecture must account for the following backend domains.

| Domain | Frontend responsibility |
|---|---|
| Authentication | Customer sign-in, registration and session handling |
| Customer accounts | Profiles, account settings and account lifecycle |
| Product catalogue | Product discovery, categories, variants and product details |
| Product media | Product image presentation and media handling |
| Product reviews | Review presentation and supported review workflows |
| Wishlist | Saved products and wishlist management |
| Shopping cart | Cart management and quantity updates |
| Checkout | Address selection, order review and checkout submission |
| Payments | Paystack payment initialization and return handling |
| Orders | Order history and order details |
| Inventory | Availability and stock-related administrative interfaces |
| Fulfilment | Package allocation and fulfilment workflows |
| Delivery | Delivery status, tracking information and exceptions |
| Returns | Return requests and return evidence |
| Refunds | Refund status and supported refund workflows |
| Warranty | Warranty claims and after-sales workflows |
| Notifications | Notification inbox and preferences |
| Staff management | Staff accounts, invitations and authorization-aware interfaces |
| Analytics | Operational and business reporting |
| Customer support | AI chatbot, human handoff and staff support interfaces |
| Realtime chat | Conversation updates and reconnect/replay functionality |
| AI usage reporting | Staff-facing AI usage and cost reporting |

This list defines the frontend scope. The exact availability, request shape, response shape and permissions of each operation must be taken from the corresponding backend implementation.

## 2.3 Backend integration rules

The frontend must not:

- Invent endpoints that do not exist.
- Assume a response property without checking the backend contract.
- Calculate authoritative prices or delivery fees.
- Mark an order paid based on a browser redirect.
- Assume a payment succeeded because Paystack's checkout window closed.
- Modify inventory directly.
- Bypass customer ownership checks.
- Assume all staff members have the same permissions.
- Expose private Cloudinary evidence through public URLs.
- Expose internal AI usage information to ordinary customers.

Before implementing each module, its existing routes, validation schemas, authentication requirements, authorization permissions and response types must be documented.

## 2.4 Confirmed API references

The following exact API routes are already established in the backend work:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/staff/analytics/overview` | Staff analytics overview |
| GET | `/api/v1/staff/analytics/sales` | Sales reporting |
| GET | `/api/v1/staff/analytics/products` | Product reporting |
| GET | `/api/v1/staff/analytics/inventory` | Inventory reporting |
| GET | `/api/v1/staff/chat/usage` | AI usage and cost reporting |

The staff analytics reporting uses the `reports.read` permission. Staff AI usage reporting uses `chat.read`.

Other endpoint paths must be mapped directly from the existing backend route definitions before their frontend implementation. The frontend team must maintain an API contract inventory rather than assume paths based on module names.

---

# 3. Frontend Application Architecture

## 3.1 Recommended application structure

The recommended architecture is a frontend workspace containing two independently deployable applications and shared packages.

```text
frontend/
│
├── apps/
│   ├── storefront/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── stores/
│   │   └── styles/
│   │
│   └── admin/
│       ├── app/
│       ├── components/
│       ├── features/
│       ├── hooks/
│       ├── services/
│       ├── stores/
│       └── styles/
│
├── packages/
│   ├── api-client/
│   ├── api-contracts/
│   ├── ui/
│   ├── validation/
│   ├── configuration/
│   └── utilities/
│
├── docs/
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

This architecture provides:

- Separation between customer and staff experiences.
- Independent application deployment.
- Shared UI primitives and API infrastructure.
- Consistent validation and formatting.
- Reduced duplication.
- Clearer security boundaries.
- Room for future application expansion.

The applications may share infrastructure, but they must not share authentication assumptions or expose staff functionality through customer-facing routes.

## 3.2 Storefront application

The storefront is responsible for all customer-facing experiences.

Its primary route groups should include:

```text
/
├── /
├── /products
├── /products/[slug]
├── /categories/[slug]
├── /search
├── /cart
├── /checkout
├── /checkout/payment
├── /orders
├── /orders/[orderId]
├── /account
├── /account/profile
├── /account/security
├── /account/addresses
├── /account/wishlist
├── /account/notifications
├── /account/orders
├── /returns
├── /returns/[returnId]
├── /warranty
├── /warranty/[claimId]
├── /login
├── /register
├── /forgot-password
└── /support
```

These are proposed frontend routes, not claims about existing backend endpoint paths.

## 3.3 Staff administration application

The administration application provides operational interfaces for authorized staff.

Proposed route groups:

```text
/
├── /login
├── /dashboard
├── /analytics
│   ├── /overview
│   ├── /sales
│   ├── /products
│   └── /inventory
├── /products
├── /products/[productId]
├── /categories
├── /inventory
├── /orders
├── /orders/[orderId]
├── /fulfilment
├── /packages
├── /deliveries
├── /delivery-zones
├── /returns
├── /refunds
├── /warranty
├── /customers
├── /customers/[customerId]
├── /staff
├── /staff/invitations
├── /notifications
├── /notification-settings
├── /chat
├── /chat/[conversationId]
├── /chat/usage
└── /settings
```

The visibility of each route and its available actions must depend on the authenticated staff member's backend permissions.

---

# 4. Technology Stack

## 4.1 Core framework

**Next.js with App Router**

Next.js is the recommended application framework.

It provides:

- Server-side rendering.
- Static rendering where appropriate.
- File-system routing.
- Route-level layouts.
- Server Components.
- Client Components.
- Metadata and SEO support.
- Route-level loading and error boundaries.
- Flexible deployment options.

Use a currently supported stable version at project initialization, with dependencies pinned and documented.

## 4.2 Programming language

**TypeScript with strict mode enabled.**

Mandatory configuration expectations:

- `strict: true`
- No unnecessary use of `any`.
- Explicit API response types.
- Typed component props.
- Typed event handlers.
- Safe handling of optional and nullable backend fields.
- Shared type definitions for API contracts.

## 4.3 Styling

**Tailwind CSS**

Requirements:

- Consistent spacing and typography.
- Reusable design tokens.
- Responsive layouts.
- Accessible colour contrast.
- Reusable component classes.
- No uncontrolled proliferation of arbitrary values.
- No inline styling as the standard styling approach.

Use CSS variables and design tokens for brand colours, surfaces, borders, typography and spacing.

## 4.4 Server-state management

**TanStack React Query**

Use React Query for backend-owned state, including:

- Product catalogues.
- Product details.
- Categories.
- Cart data.
- Wishlist data.
- Orders.
- Customer profiles.
- Notifications.
- Staff dashboards.
- Analytics.
- Delivery and return information.

Requirements:

- Centralized query keys.
- Consistent cache invalidation.
- Appropriate stale-time policies.
- Pagination and infinite-query support where needed.
- Mutation lifecycle handling.
- Controlled retries.
- No retry loops for authentication, validation or other non-retryable failures.

## 4.5 Client-state management

**Zustand**

Use Zustand only for genuinely client-owned state.

Examples:

- Temporary UI preferences.
- Mobile navigation state.
- Modal and drawer state.
- Product comparison selections, if introduced.
- Temporary non-sensitive interface state.

Do not create a second authoritative cart, order or customer database in Zustand.

## 4.6 Forms and validation

Recommended tools:

- React Hook Form.
- Zod.
- Shared validation utilities where compatible with the backend.

Frontend validation improves usability. Backend validation remains authoritative.

The frontend must display backend validation errors in a clear, field-specific manner whenever the response provides enough information to do so.

## 4.7 Additional infrastructure

| Requirement | Recommended solution |
|---|---|
| API requests | Fetch-based centralized API client |
| Forms | React Hook Form |
| Validation | Zod |
| Tables | Accessible reusable data-table components |
| Charts | A maintained React charting library |
| Icons | Consistent Lucide icon system |
| Unit tests | Vitest and React Testing Library |
| E2E tests | Playwright |
| Accessibility checks | Automated tooling plus manual testing |
| Error monitoring | Production error-monitoring service |
| Package management | pnpm workspaces |

Final package versions must be checked and pinned when implementation begins.

---

# 5. API Integration Architecture

## 5.1 Centralized API client

All backend communication must pass through a shared API client.

Responsibilities:

- Base URL management.
- Request construction.
- Authentication handling.
- Request cancellation.
- Consistent response parsing.
- Error normalization.
- Correlation/request ID propagation where supported.
- Timeout handling.
- Safe handling of network failures.
- Consistent handling of expired sessions.

Components must not independently construct arbitrary backend URLs.

## 5.2 API configuration

Use environment variables for application configuration.

Example:

```env
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_STOREFRONT_URL=
NEXT_PUBLIC_ADMIN_URL=
```

Sensitive secrets must never use `NEXT_PUBLIC_` variables.

Any server-only credential must remain on the server.

The final configuration must be aligned with the actual authentication and deployment arrangement.

## 5.3 API contract management

Maintain an API contract inventory containing:

| Field | Description |
|---|---|
| Module | Backend domain |
| Endpoint | Exact method and path |
| Authentication | Required authentication type |
| Permission | Required staff permission, if applicable |
| Request | Query, body or path parameters |
| Response | Actual backend response |
| Errors | Known error conditions |
| Frontend consumer | Application and feature using it |
| Tests | Associated integration coverage |

Where possible, generate TypeScript types from a verified OpenAPI specification.

If a complete OpenAPI specification is not available, use manually maintained contract definitions derived from the backend's actual route and validation code.

Do not create duplicate, conflicting API type definitions across applications.

## 5.4 Error-handling standard

Normalize API failures into a consistent frontend error model.

The frontend should distinguish:

- Network errors.
- Authentication errors.
- Authorization errors.
- Validation errors.
- Resource-not-found errors.
- Business-rule conflicts.
- Rate limits.
- Server errors.
- Payment-processing uncertainty.
- Unexpected response formats.

Every relevant interface must provide:

- Loading state.
- Success state.
- Empty state.
- Error state.
- Retry or recovery action where appropriate.

Never expose raw stack traces, database messages, internal paths or secrets to customers.

---

# 6. Customer Storefront Functional Specification

## 6.1 Home page

The home page should provide:

- Brand identity.
- Primary navigation.
- Search.
- Featured products.
- Product categories.
- Promotional content where supported.
- Product recommendations where supported.
- Clear calls to action.
- Footer with relevant customer information.

Do not hardcode product inventory or pricing into the page.

Product content must come from the backend.

## 6.2 Product catalogue

The catalogue must support:

- Product listing.
- Category navigation.
- Search.
- Pagination or infinite loading.
- Sorting supported by the backend.
- Filtering supported by the backend.
- Product availability.
- Product images.
- Product variants.
- Price presentation.
- Empty results.
- Loading and failure states.

Only expose filters and sorting options supported by actual backend capabilities.

## 6.3 Product details

Product detail pages should provide:

- Product name.
- Description.
- Product imagery.
- Variant selection.
- Price.
- Availability.
- Quantity selection.
- Add-to-cart action.
- Wishlist action.
- Product reviews where supported.
- Related products where supported.

The frontend must respect backend variant and stock constraints.

A disabled purchase button is a usability feature, not a substitute for server-side stock validation.

## 6.4 Shopping cart

The cart should support:

- Adding products.
- Removing products.
- Updating quantities.
- Displaying selected variants.
- Showing item availability.
- Displaying backend-calculated pricing.
- Displaying relevant cart validation errors.
- Proceeding to checkout.

The frontend must not treat locally stored cart values as the authoritative checkout source.

The backend remains responsible for validating products, variants, stock and totals.

## 6.5 Wishlist

The wishlist should support:

- Adding products.
- Removing products.
- Viewing saved products.
- Moving products to the cart where supported.
- Empty wishlist state.
- Loading and error states.

The frontend must account for unavailable or discontinued products.

## 6.6 Customer authentication

The authentication experience should include:

- Registration.
- Login.
- Logout.
- Forgot password.
- Password reset.
- Session restoration.
- Authentication expiry handling.

The implementation must follow the backend's actual authentication mechanism.

Do not assume whether the backend uses cookies, bearer tokens or another mechanism until its authentication routes and middleware have been verified.

Security requirements:

- Never store passwords in browser storage.
- Do not expose authentication secrets to client-side JavaScript.
- Protect authenticated routes.
- Handle logout and session expiry consistently.
- Avoid leaking account existence through error messages where the backend uses generic responses.
- Apply appropriate protections against CSRF, XSS and token theft based on the actual session mechanism.

## 6.7 Guest customer experience

Guest workflows are part of the existing backend scope.

The frontend must support applicable guest capabilities without forcing account creation unnecessarily.

Potential workflows include:

- Guest checkout.
- Guest order access.
- Guest after-sales access.
- Guest return evidence submission.

Guest access tokens and capabilities must be handled as credentials.

Requirements:

- Never expose guest tokens in analytics events.
- Do not place tokens in public URLs unnecessarily.
- Avoid logging tokens.
- Handle expiration and revocation.
- Never allow a guest to access another customer's order.
- Use the backend's exact token transport and validation requirements.

## 6.8 Checkout

Checkout is one of the most critical customer journeys.

The experience should include:

1. Cart review.
2. Customer or guest identification.
3. Shipping address selection or entry.
4. Server-validated delivery availability.
5. Order summary.
6. Backend-calculated totals.
7. Order creation and payment initialization.
8. Payment handoff.
9. Payment outcome handling.
10. Confirmation and order details.

The frontend must not independently determine the final order total.

The backend is responsible for authoritative price calculation, order creation, inventory reservation and payment initialization.

Checkout must prevent duplicate submissions and handle uncertain network outcomes without creating duplicate orders.

## 6.9 Paystack payment integration

Paystack is the project's payment provider.

The payment experience must:

- Initialize payment through the backend.
- Use the payment authorization information returned by the backend.
- Redirect or open the supported Paystack payment interface.
- Handle successful returns.
- Handle failed returns.
- Handle cancelled or abandoned payments.
- Handle network interruption.
- Present pending or uncertain payment states appropriately.
- Refresh the backend order/payment status.

**A browser redirect is not proof of payment.**

The backend's verified payment state is authoritative.

The frontend must not:

- Mark orders paid locally.
- Trust query parameters as proof of payment.
- Expose Paystack secret keys.
- Create independent payment references.
- Retry payment initialization blindly after an uncertain outcome.

Currency presentation must follow the backend's actual order currency. The project uses NGN commerce totals. AI usage cost reporting may use USD and must not be confused with customer order currency.

## 6.10 Customer order management

Customers should be able to:

- View order history.
- Open individual orders.
- Review order items.
- View payment status.
- View fulfilment and delivery information.
- Access supported cancellation options.
- Start eligible returns.
- View refund status.
- Access applicable warranty information.

Actions must reflect the order's actual backend state.

For example, the frontend must not offer cancellation when the backend's business rules prohibit it.

## 6.11 Returns, refunds and warranty

Provide dedicated interfaces for:

- Return eligibility and submission.
- Return reasons where supported.
- Return status.
- Evidence uploads.
- Warranty claim submission.
- Warranty claim details.
- Refund progress.
- Rejected or incomplete requests.
- Follow-up actions.

The backend supports protected guest return evidence workflows using guest access controls and private Cloudinary storage.

The frontend must respect the backend's evidence constraints, including the established five-file and 20 MB limits where applicable.

Private evidence must be displayed or downloaded only through authorized backend-provided access mechanisms.

Do not expose private media through permanent public URLs.

## 6.12 Customer account lifecycle

The account area should include:

- Profile management.
- Security settings.
- Password-related actions.
- Addresses where supported.
- Order history.
- Wishlist.
- Notification preferences.
- Account deactivation or deletion where supported.

Account deletion must clearly communicate that the backend may defer anonymization when active warranty coverage or unresolved payment reconciliation requires it.

The frontend must display the actual lifecycle state returned by the backend rather than assume that a submitted deletion request means immediate permanent deletion.

---

# 7. Staff Administration Functional Specification

## 7.1 Staff dashboard

The staff dashboard should provide a clear operational overview.

Potential information:

- Sales performance.
- Order activity.
- Inventory status.
- Delivery activity.
- Return and warranty activity.
- Operational exceptions.
- Notifications.
- Relevant trends.

Only use data available through verified backend reporting endpoints.

Do not fabricate dashboard statistics or calculate authoritative business metrics from incomplete browser data.

## 7.2 Staff authentication and permissions

Staff interfaces must integrate with backend authentication and authorization.

The backend uses permission-based staff authorization.

The frontend must:

- Obtain the authenticated staff identity and permitted capabilities from the backend.
- Render navigation based on available permissions.
- Hide unavailable actions.
- Guard protected routes.
- Handle revoked or expired access.
- Refresh authorization context where appropriate.
- Display access-denied states.

Hiding an action in the UI is not sufficient authorization.

The backend must enforce every protected operation.

## 7.3 Product management

Provide staff interfaces for:

- Product listing.
- Product creation.
- Product editing.
- Product status management.
- Product variants.
- Product imagery.
- Product category assignment.
- Product search and filtering.
- Product detail inspection.

Forms must validate required data and display backend validation errors.

Image management must respect the existing media-storage and cleanup lifecycle.

## 7.4 Category management

Support the backend's actual category operations.

Provide:

- Category listing.
- Creation.
- Editing.
- Status management.
- Product association where supported.

Do not assume hierarchical categories unless the backend explicitly supports them.

## 7.5 Inventory management

Provide:

- Inventory overview.
- Product/variant stock information.
- Relevant stock adjustments.
- Low-stock information where supported.
- Reservation-related operational visibility where supported.
- Inventory exception states.

The frontend must not directly modify inventory records outside the backend's authorized business operations.

## 7.6 Order management

Staff should be able to:

- View orders.
- Search and filter orders.
- Inspect order details.
- View customer and guest order information as authorized.
- View payment status.
- Inspect fulfilment status.
- Access supported cancellation and refund actions.

All state changes must use the corresponding backend operations.

## 7.7 Package allocation and fulfilment

The backend includes package allocation functionality.

The frontend must provide operational interfaces for:

- Orders ready for fulfilment.
- Package creation and management.
- Allocating order items to packages.
- Displaying allocated quantities.
- Preventing duplicate allocation in the interface.
- Preparing packages for delivery.
- Displaying tracking information.

The backend remains responsible for preventing allocation of more units than ordered or allocating the same units more than once.

## 7.8 Delivery management

Provide staff interfaces for:

- Delivery status.
- Package tracking information.
- Staff assignment where supported.
- Delivery exceptions.
- Delivery zones.
- Relevant operational updates.

The frontend must distinguish between supported internal delivery workflows and external courier integrations.

Do not represent a courier integration as available until the backend actually implements and verifies it.

## 7.9 Returns, refunds and warranty administration

Staff interfaces should provide:

- Incoming return requests.
- Return evidence inspection.
- Return decision workflows.
- Refund intervention information.
- Warranty claim inspection.
- Claim status.
- Relevant audit and exception information.

Private evidence must remain protected.

Sensitive actions must include confirmation and clear outcome messages.

## 7.10 Staff management

Provide interfaces for:

- Staff listing.
- Staff details.
- Staff invitations.
- Invitation status.
- Staff account lifecycle.
- Role and permission visibility where supported.

The backend has a dedicated staff invitation lifecycle. The frontend must use its secure invitation process rather than create an alternative invitation mechanism.

Never expose invitation secrets or acceptance tokens unnecessarily.

## 7.11 Notification administration

Staff notification interfaces should include:

- Notification inbox.
- Read/unread state.
- Notification details.
- Supported notification preferences.
- Relevant delivery exceptions.

The backend's notification policy distinguishes routine in-app notifications from urgent or actionable events that may also be sent by email.

The frontend should respect that policy rather than imply every notification is an email notification.

## 7.12 Analytics

The administration application should consume the existing reporting capabilities.

Confirmed endpoints:

- `/api/v1/staff/analytics/overview`
- `/api/v1/staff/analytics/sales`
- `/api/v1/staff/analytics/products`
- `/api/v1/staff/analytics/inventory`

The frontend should support:

- Date filters.
- Reporting summaries.
- Sales visualizations.
- Product performance.
- Inventory reporting.
- Loading and error states.
- Empty datasets.
- Currency-aware presentation.

NGN commerce figures and USD AI cost estimates must remain distinct.

Do not combine monetary values with different currencies without an explicit conversion methodology.

## 7.13 AI usage reporting

The backend provides:

`GET /api/v1/staff/chat/usage`

This reporting interface should display authorized operational information such as:

- Usage counts.
- Input tokens.
- Output tokens.
- Total tokens.
- Estimated cost where configured.
- Provider and model aggregates.
- Processing duration.
- Outcome and persistence information where exposed by the API.

Cost estimates may be unavailable until pricing configuration is supplied.

The frontend must clearly distinguish unavailable costs from zero costs.

Customer messages, customer identifiers and private conversation content must not be exposed through aggregate usage reporting.

---

# 8. Customer Support and Realtime Chat

## 8.1 Chat experience

The storefront should provide an accessible customer support interface.

It should support the backend's actual capabilities, including:

- Customer conversations.
- Guest conversations where supported.
- AI-assisted responses.
- Human handoff.
- Conversation status.
- Staff responses.
- Conversation history.

## 8.2 Human handoff

When a conversation requires human support:

- Display the current handoff state.
- Explain whether a human agent is required or assigned.
- Preserve conversation context.
- Avoid presenting an AI response as a staff response.
- Handle waiting and unavailable states clearly.

## 8.3 Realtime events

The backend includes durable realtime event storage and reconnect replay.

The frontend must:

- Establish the supported realtime connection.
- Process incoming events.
- Track the appropriate sequence/cursor.
- Replay missed events after reconnect.
- Deduplicate repeated events.
- Recover from network interruption.
- Avoid losing visible conversation state during reconnection.
- Handle pagination of historical events where applicable.

The frontend must not assume that a successful socket connection guarantees every event has been received.

The durable backend replay mechanism should be used according to its actual API contract.

## 8.4 Realtime reliability

Required interface states:

- Connecting.
- Connected.
- Reconnecting.
- Disconnected.
- Replaying missed events.
- Failed to reconnect.
- Conversation closed.

A customer must be able to understand when a message is still pending and when it has been accepted by the backend.

---

# 9. Design System and User Experience Standards

## 9.1 Visual direction

The storefront should communicate:

- Trust.
- Clarity.
- Ease of shopping.
- Product quality.
- Professionalism.

The administration application should communicate:

- Operational clarity.
- Accuracy.
- Information hierarchy.
- Efficient workflows.
- Clear exception handling.

The two applications should share design tokens and component foundations while maintaining distinct information architectures.

## 9.2 Design tokens

Establish centralized tokens for:

- Brand colours.
- Neutral surfaces.
- Text colours.
- Status colours.
- Typography.
- Spacing.
- Borders.
- Shadows.
- Radius.
- Breakpoints.
- Motion.
- Focus indicators.

Status colours must have accompanying text or icons. Colour must never be the only indicator of meaning.

## 9.3 Reusable components

Create reusable components for:

- Buttons.
- Inputs.
- Selects.
- Textareas.
- Checkboxes.
- Radio controls.
- Dialogs.
- Drawers.
- Dropdowns.
- Tabs.
- Tables.
- Pagination.
- Breadcrumbs.
- Badges.
- Tooltips.
- Alerts.
- Toasts.
- Skeleton loaders.
- Empty states.
- Error states.
- Product cards.
- Product galleries.
- Price displays.
- Order status indicators.
- File uploads.

Components must support accessibility, responsive behaviour and consistent validation feedback.

## 9.4 Responsive design

Support:

- Small mobile devices.
- Large mobile devices.
- Tablets.
- Laptops.
- Desktop monitors.
- Wide desktop screens.

The storefront must remain usable on small screens.

The administration application should use responsive tables, controlled overflow and mobile-friendly navigation rather than simply shrinking desktop layouts.

## 9.5 Accessibility

Target WCAG 2.2 AA.

Requirements include:

- Semantic HTML.
- Keyboard navigation.
- Visible focus indicators.
- Appropriate labels.
- Accessible form errors.
- Sufficient contrast.
- Screen-reader support.
- Accessible dialogs.
- Reduced-motion support.
- Meaningful image alternatives.
- Correct heading hierarchy.

Accessibility must be part of component development, not a final cosmetic exercise.

---

# 10. Security Architecture

Security is a release requirement, not an optional enhancement.

## 10.1 Authentication security

- Follow the backend's actual authentication mechanism.
- Protect sensitive session material.
- Avoid storing credentials in local storage.
- Apply appropriate CSRF protection.
- Handle session expiry.
- Prevent unauthorized access to private routes.
- Avoid leaking authentication information in logs.

## 10.2 Authorization

- Enforce backend permissions.
- Separate customer and staff application boundaries.
- Prevent customer routes from exposing staff information.
- Do not rely on client-side role checks as the security boundary.
- Handle revoked permissions and expired sessions.

## 10.3 Input and output security

- Validate user input.
- Render untrusted content safely.
- Avoid unsafe HTML injection.
- Sanitize rich content where appropriate.
- Never expose raw backend exceptions.
- Avoid placing secrets in URLs or logs.

## 10.4 File upload security

- Respect backend-supported MIME types and file sizes.
- Validate files before submission for usability.
- Do not trust browser file metadata as authoritative.
- Display upload progress and failure states.
- Protect private customer evidence.
- Use backend-authorized access for private downloads.

## 10.5 Payment security

- Keep Paystack secret credentials on the backend.
- Use backend-generated payment initialization details.
- Treat payment status as server-owned.
- Handle uncertain payment outcomes safely.
- Prevent duplicate checkout submissions.
- Never store payment credentials in browser storage.

## 10.6 Privacy

- Do not expose customer personal information unnecessarily.
- Do not include sensitive information in analytics events.
- Avoid logging tokens, passwords, payment secrets or private evidence URLs.
- Respect account deletion and anonymization states.
- Protect guest order access.

---

# 11. Performance and Reliability

## 11.1 Performance objectives

The applications should target the following Core Web Vitals at the 75th percentile of real-user measurements:

| Metric | Target |
|---|---:|
| Largest Contentful Paint | ≤ 2.5 seconds |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.1 |

These are production targets, not claims of measured current performance.

## 11.2 Performance practices

- Server-render public catalogue and product pages where appropriate.
- Optimize images.
- Use responsive image sizes.
- Lazy-load non-critical media.
- Avoid unnecessarily large client bundles.
- Split large feature modules.
- Cache only data with safe freshness characteristics.
- Avoid excessive API requests.
- Paginate large datasets.
- Use skeletons without causing layout shifts.
- Monitor slow interactions and API failures.

## 11.3 Reliability

The frontend must handle:

- Backend downtime.
- Slow network responses.
- Timeouts.
- Expired sessions.
- Payment interruptions.
- Realtime disconnections.
- Failed uploads.
- Stale data.
- Duplicate user submissions.

Critical actions must never silently fail.

---

# 12. SEO and Discoverability

Public storefront pages should support:

- Page titles.
- Meta descriptions.
- Canonical URLs.
- Open Graph metadata.
- Social sharing images.
- Product metadata where appropriate.
- Structured data where accurate and supported.
- Sitemap generation.
- Robots directives.
- Clean URLs.

Private customer and staff pages must not be indexed.

The administration application should be excluded from search-engine indexing.

---

# 13. Testing and Quality Assurance

Testing must cover both individual components and complete business journeys.

## 13.1 Unit tests

Test:

- Utility functions.
- Formatters.
- Validation.
- API error handling.
- State transitions.
- Reusable components.
- Permission-aware rendering.

## 13.2 Integration tests

Test:

- API client behaviour.
- Authentication handling.
- Query invalidation.
- Form submission.
- Error mapping.
- File uploads.
- Payment status refresh.
- Realtime event processing.

## 13.3 End-to-end tests

Mandatory critical journeys:

**Customer workflows**

1. Browse products.
2. Search and filter products.
3. Open product details.
4. Add a product to the cart.
5. Update cart quantity.
6. Complete guest checkout where supported.
7. Complete registered customer checkout.
8. Initiate Paystack payment.
9. Handle successful, failed and uncertain payment states.
10. View order history.
11. Access eligible after-sales workflows.
12. Submit return evidence.
13. Use customer support.

**Staff workflows**

1. Staff authentication.
2. Permission-based dashboard access.
3. Product management.
4. Category management.
5. Inventory operations.
6. Order inspection.
7. Package allocation.
8. Delivery management.
9. Return and warranty inspection.
10. Notification management.
11. Analytics reporting.
12. Staff invitation workflow.
13. Human support conversations.
14. AI usage reporting.

## 13.4 Security tests

Test:

- Unauthorized route access.
- Missing permissions.
- Expired sessions.
- Cross-customer resource access.
- Guest token expiry and revocation.
- Private evidence access.
- Unsafe input handling.
- Duplicate submissions.
- Payment return manipulation.
- Sensitive information leakage.

## 13.5 Release quality gates

A frontend feature is not complete until:

- Its backend contract is verified.
- TypeScript checks pass.
- Linting passes.
- Unit and integration tests pass.
- Relevant E2E tests pass.
- Responsive behaviour is verified.
- Accessibility is reviewed.
- Error and empty states are implemented.
- Security implications are reviewed.
- Documentation is updated.

A visually complete interface with incomplete business behaviour is not considered production-ready.

---

# 14. Observability and Operational Monitoring

The frontend should provide useful production telemetry without collecting unnecessary personal information.

Monitor:

- JavaScript exceptions.
- Failed page loads.
- API failure rates.
- Slow requests.
- Payment-flow failures.
- Checkout abandonment signals where appropriately implemented.
- Failed uploads.
- Realtime reconnect failures.
- Critical interaction failures.

Use correlation identifiers when the backend provides them.

Do not log:

- Passwords.
- Access tokens.
- Guest access tokens.
- Paystack secret credentials.
- Private evidence URLs.
- Sensitive customer messages.
- Unnecessary personal information.

Monitoring must distinguish frontend failures from backend failures.

---

# 15. Deployment and Environment Management

## 15.1 Deployment architecture

Recommended deployment topology:

- Storefront: independently deployable web application.
- Admin: independently deployable web application.
- Backend: existing API service.
- PostgreSQL: existing backend database.
- Cloudinary: existing media infrastructure.
- Paystack: existing payment provider.

Final hosting providers, domains, CDN, DNS and deployment pipeline will be selected during implementation planning.

## 15.2 Environment separation

Maintain separate:

- Development.
- Testing.
- Staging.
- Production.

Each environment must use the correct API URL and payment configuration.

Never point production users to test services.

## 15.3 Release process

Every release should follow:

1. Feature implementation.
2. Local validation.
3. Pull request review.
4. Automated tests.
5. Staging deployment.
6. End-to-end verification.
7. Security and regression review.
8. Production approval.
9. Deployment.
10. Post-deployment monitoring.

Database migrations remain a backend responsibility.

Frontend deployment must not automatically execute Prisma migrations.

---

# 16. Implementation Roadmap

Frontend implementation should be delivered in controlled phases.

## Phase 1 — Foundation

- Establish frontend workspace.
- Configure Next.js applications.
- Configure TypeScript strict mode.
- Configure Tailwind CSS.
- Configure linting and formatting.
- Establish shared packages.
- Implement API client.
- Establish environment configuration.
- Establish design tokens.
- Implement shared UI components.
- Establish testing infrastructure.

**Exit criteria:** Both applications start successfully, share the approved infrastructure and can communicate with the backend in a controlled development environment.

## Phase 2 — Customer storefront foundation

- Global layout.
- Navigation.
- Home page.
- Product catalogue.
- Categories.
- Search.
- Product details.
- Product images.
- Product variants.

**Exit criteria:** Customers can discover and inspect real backend products.

## Phase 3 — Customer identity and shopping

- Registration.
- Login.
- Password recovery.
- Customer profile.
- Wishlist.
- Shopping cart.
- Address workflows.

**Exit criteria:** Customer identity and shopping operations work through verified backend contracts.

## Phase 4 — Checkout and payments

- Checkout experience.
- Address validation.
- Delivery options.
- Order summary.
- Paystack initialization.
- Payment outcome handling.
- Order confirmation.
- Payment recovery.

**Exit criteria:** End-to-end checkout is verified, including uncertain and failed payment scenarios.

## Phase 5 — Customer after-sales

- Order history.
- Order details.
- Delivery visibility.
- Returns.
- Return evidence.
- Refund visibility.
- Warranty workflows.
- Customer account lifecycle.

**Exit criteria:** Supported customer after-sales workflows are accessible and secure.

## Phase 6 — Administration foundation

- Staff authentication.
- Permission-aware navigation.
- Dashboard.
- Product management.
- Category management.
- Inventory management.

**Exit criteria:** Authorized staff can access and operate core commerce management functions.

## Phase 7 — Fulfilment and operations

- Order administration.
- Package allocation.
- Delivery management.
- Delivery zones.
- Returns.
- Refund operations.
- Warranty administration.
- Customer management.
- Staff management.

**Exit criteria:** Core operational workflows are accessible through the staff application.

## Phase 8 — Analytics and notifications

- Staff analytics.
- Sales reports.
- Product reports.
- Inventory reports.
- Notification inbox.
- Notification preferences.
- Operational exception visibility.

**Exit criteria:** Staff can access verified operational information and manage supported notifications.

## Phase 9 — Chat and AI integration

- Customer chat interface.
- AI conversations.
- Human handoff.
- Staff chat interface.
- Realtime events.
- Reconnect replay.
- AI usage reporting.

**Exit criteria:** Customer and staff chat experiences recover reliably from interruptions and respect backend authorization.

## Phase 10 — Production hardening

- Accessibility audit.
- Performance optimization.
- Security review.
- Cross-browser testing.
- Mobile testing.
- E2E regression.
- Error monitoring.
- Staging verification.
- Production deployment preparation.

**Exit criteria:** All production release gates are satisfied.

---

# 17. Definition of Done

A feature is complete only when all applicable conditions are met.

| Area | Completion requirement |
|---|---|
| Backend integration | Verified against the actual backend contract |
| Type safety | Strict TypeScript checks pass |
| UI | Responsive and consistent |
| UX | Loading, success, empty and error states exist |
| Security | Authentication and authorization are respected |
| Accessibility | Meets applicable accessibility standards |
| Validation | Client and backend validation are handled |
| Reliability | Failure and recovery paths are implemented |
| Testing | Appropriate automated tests pass |
| Documentation | Relevant technical documentation is updated |
| Review | Code has been reviewed before merging |

A visually complete interface with incomplete business behaviour is not considered production-ready.

---

# 18. Architectural Decisions and Constraints

The following decisions form the proposed baseline:

| Decision | Standard |
|---|---|
| Frontend architecture | Two independently deployable applications |
| Shared infrastructure | Workspace packages |
| Framework | Next.js App Router |
| Language | TypeScript strict mode |
| Styling | Tailwind CSS |
| API state | TanStack React Query |
| Client state | Zustand |
| Forms | React Hook Form |
| Validation | Zod |
| Payment provider | Paystack only |
| API integration | Existing versioned backend |
| Commerce currency | Backend-defined NGN totals |
| AI cost reporting | USD where configured and returned |
| Authorization | Backend-enforced permissions |
| Media | Existing Cloudinary integration |
| Testing | Unit, integration and E2E |
| Accessibility | WCAG 2.2 AA target |
| Production quality | Performance, security and operational monitoring |

## 18.1 Explicit exclusions

The frontend must not independently introduce:

- A second payment provider.
- A second inventory system.
- A separate order database.
- Independent price calculation as an authoritative source.
- Alternative authentication rules.
- An unverified courier integration.
- Unverified backend API endpoints.
- Unapproved changes to backend business rules.

Any new capability requiring backend work must be identified and reviewed separately.

---

# 19. Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Incorrect API assumptions | Verify every endpoint and schema before implementation |
| Frontend/backend contract drift | Centralized API contracts and integration tests |
| Payment uncertainty | Backend-authoritative payment status and safe recovery |
| Permission leakage | Backend authorization and permission-aware UI |
| Duplicate checkout | Submission protection and idempotent backend operations where supported |
| Realtime event loss | Durable replay and event deduplication |
| Private evidence exposure | Authorized access to protected media |
| Stale inventory | Server-side validation and controlled cache invalidation |
| Inconsistent customer state | Backend-owned server state |
| Poor mobile experience | Mobile-first responsive implementation |
| Performance degradation | Bundle analysis and real-user monitoring |
| Incomplete production readiness | Defined release gates and staging verification |

---

# 20. Final Acceptance Standard

The frontend project will be considered ready for production only when:

1. The storefront supports the intended customer shopping lifecycle.
2. Checkout and Paystack payment handling are verified end to end.
3. Customer account and after-sales workflows operate correctly.
4. Staff can perform authorized operational workflows.
5. Analytics and notifications display backend-sourced information accurately.
6. AI and human support interfaces work with the backend's realtime capabilities.
7. Guest and registered customer access controls are respected.
8. No frontend-only security control is relied upon to protect backend resources.
9. Automated tests cover critical business journeys.
10. Accessibility and performance targets have been evaluated.
11. Monitoring and operational recovery are in place.
12. Staging verification and production release reviews are complete.

---

# 21. Closing Statement

The objective is not simply to create a visually attractive storefront or an administrative dashboard.

The objective is to deliver a complete, maintainable, secure and scalable frontend platform that makes the existing `my-devops-project` backend usable as a professional commerce product.

The backend already provides a substantial business foundation. The frontend must expose that foundation through reliable customer and staff experiences without weakening its security, duplicating its business logic or bypassing its operational safeguards.

**This specification is the proposed technical baseline for frontend development.**

Implementation should begin only after the architecture is accepted and the actual backend API contracts have been inventoried and mapped to the planned frontend features.

**Document end.**
