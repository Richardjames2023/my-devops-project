# Frontend Implementation Progress and Roadmap

**Project:** `my-devops-project`  
**Storefront brand/design:** ShopSphere  
**Last updated:** 21 November 2026  
**Status:** Active implementation — storefront foundation in progress

> This is the living delivery record for frontend implementation. It complements, and does not replace, the [Frontend Architecture & Implementation Specification](./FRONTEND_ARCHITECTURE_AND_IMPLEMENTATION_SPECIFICATION.md). Update this document as PRs are reviewed, merged, tested, and completed.

---

## 1. Product direction: ShopSphere is the source design

**Yes: the ShopSphere design image is the primary visual reference for the customer storefront.** It is not merely an optional inspiration image. New storefront screens and components must follow that approved design direction unless a deliberate design change is reviewed and agreed.

Primary design asset:

- [ShopSphere Storefront UI/UX Design System image](./design/storefront/ShopSphere%20Storefront%20UI_UX%20Design%20System.png)
- Design asset was introduced in [PR #53](https://github.com/Richardjames2023/my-devops-project/pull/53).

### 1.1 Approved colour direction

Use the supplied ShopSphere palette consistently:

| Role | Colour | Intended use |
|---|---|---|
| Main page surface | `#FBF9F6` | Warm page background |
| Card/header/icon tile | `#FFFFFF` | Cards, header and icon tiles |
| Search surface | `#F4F6FA` | Search field background |
| Soft blue surface | `#E9F1FE` | Supporting blue-tinted surfaces |
| Soft peach surfaces | `#FDF0E8`, `#FDF5ED` | Warm accent backgrounds |
| Primary blue | `#1D52BD` | Primary structural colour |
| Deep navy | `#081C41` | Strong text/structure |
| Optional gradient start | `#102F6D` | Approved blue gradient use |
| Orange accent | `#EC702E` | Primary CTA, sale badge, basket count and logo accent |
| Dark orange-brown | `#9E4A1B` | Text links on peach backgrounds |
| Success/express green | `#337245` | Express delivery and success only |
| Body text | `#373E4B` | Main body copy |

The visual balance is approximately **60% surfaces, 30% structure and 10% accents**. Maintain clear contrast and do not use colour as the only indicator of status.

### 1.2 Product and content rules

- NGN (₦) is the storefront currency presentation where backend values are NGN.
- Any product names, images, prices, ratings or stock shown in design mockups are placeholders until supplied by the live backend.
- Do not hardcode catalogue inventory or authoritative prices.
- Do not invent shipping fees, discounts, return/warranty promises, support hours or store policies.
- The backend remains the authority for product availability, pricing, checkout totals, payment status and business rules.

---

## 2. Repository and application decisions

The frontend work is in the existing repository folders:

- `frontend/client` — customer storefront.
- `frontend/admin` — staff administration.

**Preserve these existing folders and their existing Next.js work.** The architecture specification describes a possible workspace with `apps/storefront` and `apps/admin`; the implementation decision for this project is to retain `frontend/client` and `frontend/admin` as the foundation rather than rename or replace them.

The client is currently a Next.js 15.4.5 application using React 19 and TypeScript. The current client package uses pnpm and has a `pnpm-lock.yaml`.

Target technology direction from the architecture specification:

- Next.js App Router and strict TypeScript.
- Tailwind CSS and shared design tokens.
- TanStack React Query for backend-owned/server state.
- Zustand only for client-owned UI state, not as a second source of truth for cart, orders or customer data.
- React Hook Form and Zod for forms and validation.
- Vitest/React Testing Library for unit and component tests; Playwright for end-to-end journeys.

Do not add dependencies or restructure the workspace without checking the existing package and lockfile setup first.

---

## 3. Delivery records and current PRs

The following PRs form the current frontend delivery sequence:

| PR | Scope | Current recorded state |
|---|---|---|
| [#53 — ShopSphere design board](https://github.com/Richardjames2023/my-devops-project/pull/53) | Adds the approved storefront design image | Open; not merged |
| [#54 — Frontend application foundations](https://github.com/Richardjames2023/my-devops-project/pull/54) | Preserves and introduces the existing client/admin application foundations | Open; not merged |
| [#55 — Storefront API foundation](https://github.com/Richardjames2023/my-devops-project/pull/55) | Storefront package/API foundation and build fixes | Open; not merged |

PR #55 is intentionally stacked on PR #54 because the existing frontend foundations are not yet on `dev`. Do not retarget #55 to `dev` or merge any of these PRs until the dependency order has been reviewed and explicitly approved.

### 3.1 PR #54 — frontend application foundations

- Branch: `feat/frontend-foundation-review`
- Commit recorded: `6bb3011`
- Retains the existing `frontend/client` and `frontend/admin` applications.
- Does not migrate to a new `apps/` layout.
- Does not include environment secrets or generated dependency/build directories.
- No build/lint result was recorded for this PR at creation.

### 3.2 PR #55 — storefront API foundation

- Branch: `feat/storefront-client-foundation`
- Latest recorded commit: `04319dc` — `fix(frontend): harden storefront API client boundaries`
- Earlier commits corrected package dependency metadata/lockfile alignment, added the API client and environment example, and resolved production build issues.
- The branch is stacked on PR #54.
- No merge has been performed.

Current API client: [frontend/client/src/lib/api/client.ts](../../frontend/client/src/lib/api/client.ts).

The client currently provides:

- Configurable API base URL, defaulting to `http://localhost:5000/api/v1`.
- Typed `apiRequest<T>` helper.
- `ApiError` with HTTP status and details.
- In-memory access-token setter/getter; no localStorage/sessionStorage persistence.
- Optional bearer authorization for authenticated calls.
- JSON request-body serialization.
- HTTP 204 handling.
- Response parsing and normalized errors, including malformed JSON responses.
- Fetch credentials default to `same-origin`; cross-origin cookie workflows must explicitly opt in with `credentials: "include"`.

**Security boundary still outstanding:** the current backend customer and staff login routes return access and refresh tokens in JSON, while refresh tokens are rotated through a JSON request body. The in-memory browser token is transitional and is not a complete persistent production session architecture. Before persistent customer/staff sessions are delivered, design and implement a secure server-side session/BFF with HttpOnly cookies and appropriate CSRF/origin protections. Never persist bearer or refresh tokens in localStorage/sessionStorage.

Guest-session and guest-cart flows rely on the backend's HttpOnly guest cookie. Calls that need the cross-origin guest cookie must explicitly use `credentials: "include"`.

---

## 4. Verified local setup and validation

These results were reported from the developer's local machine on 21 November 2026. They are local test evidence, not GitHub CI results.

### 4.1 Environment and dependencies

- Node.js: `v22.23.2`
- npm: `10.9.8`
- Corepack: `0.34.6`
- pnpm activated: `12.21.0`
- `pnpm install --frozen-lockfile` initially stopped because pnpm blocked install scripts for `@tailwindcss/oxide`, `sharp` and `unrs-resolver`.
- The developer explicitly approved those three packages with `pnpm approve-builds`; their install/postinstall scripts then completed successfully.

### 4.2 Latest reported checks

After pulling commit `04319dc`:

| Command | Reported result |
|---|---|
| `pnpm lint` | Completed successfully: 0 errors, 4 warnings |
| `pnpm build` | Passed |
| TypeScript validation during build | Passed |
| Static page generation | Passed, 7/7 |
| `git diff --check` | Passed with no output |

The production build listed these routes: `/`, `/_not-found`, `/cart`, `/products`, and `/products/[id]`.

### 4.3 Outstanding warnings and configuration observations

Four lint warnings remain:

- `src/components/Navbar.tsx`: unused `ShoppingCart` import.
- `src/components/PaymentForm.tsx`: unused `ArrowRight` import.
- `src/components/PaymentForm.tsx`: unused `router` variable.
- `src/components/PaymentForm.tsx`: unused `data` parameter.

The production build also warns that it found multiple lockfiles and selected the repository-root `package-lock.json`, while the client has `pnpm-lock.yaml`.

Do not delete either lockfile to silence the warning. Inspect the root package configuration, frontend package configuration, Next.js root detection and the local workspace file first; choose and document an intentional package-manager/workspace arrangement.

### 4.4 Local untracked files to preserve

At the last reported `git status --short`, these were untracked:

- Backend migration/test diagnostic folder `backend/prisma/migrations/20261114135922_npx_vitest_run_tests_customer_account_lifecycle_postgres_test_ts_pool_forks_max_workers_1/`
- `backend/remove-test-diagnostics.py.save`
- `backend/shop_db_before_20261115_migrations.dump`
- `backend/shop_db_before_pending_migrations.dump`
- `backend/tests/customer-account-lifecycle-postgres.test.ts.before-indent-fix`
- `local-work-backup/`
- `frontend/client/pnpm-workspace.yaml`

These are local user files and backups. Do not stage, delete, reset, stash or overwrite them as part of routine frontend cleanup without first inspecting and obtaining explicit direction. The workspace YAML is not yet a committed/approved workspace configuration.

---

## 5. Backend integration constraints

The frontend must consume the existing backend under `/api/v1`; it must not invent routes or duplicate backend business rules.

Verified integration facts to preserve:

- Customer auth routes include registration, email verification, password recovery, login, refresh and `/me`.
- Staff auth is separate and includes invitation exchange/acceptance, login, refresh and `/me`.
- Access tokens are sent as Bearer tokens to protected API endpoints.
- Customer and staff refresh endpoints accept refresh tokens in JSON bodies and rotate refresh tokens.
- Guest session uses an HttpOnly cookie; guest cart routes require that session.
- Customer cart and guest cart are separate backend route groups.
- Customer checkout and guest checkout are separate flows.
- Checkout submits shipping address data; guest checkout additionally supplies customer email.
- Paystack is the only integrated payment provider.
- Payment success must be verified by the backend; a browser redirect or checkout popup closing is not proof of payment.
- Backend authorization and ownership checks remain authoritative. Hiding a UI control is not an authorization mechanism.
- Backend-calculated prices, discounts, delivery charges and order totals are authoritative.

Before implementing each feature, verify its exact route, schema, response, auth requirement and permission against the backend source.

---

## 6. Current implementation status

| Area | Status | Notes |
|---|---|---|
| Main architecture specification | Documented | On `dev` |
| ShopSphere design reference | Documented | Design asset in PR #53 |
| Existing client/admin foundations | Prepared in PR | PR #54 open |
| Storefront package baseline | Implemented in PR | PR #55 open |
| Storefront API helper | Implemented in PR | Latest commit `04319dc` |
| Local dependency install | Completed | Install scripts explicitly approved |
| Local lint | Passed with warnings | Four unused-variable warnings |
| Production build | Passed | 7/7 static pages generated |
| API-client automated tests | Not yet established | No configured Vitest suite in client package was found during this work |
| React Query setup | Not yet implemented/verified | Next foundation step |
| Secure persistent session/BFF | Not implemented | Required before production auth persistence |
| Live catalogue integration | Not yet implemented/verified | Current pages still include placeholder content |
| Cart/wishlist backend integration | Not yet implemented/verified | Existing UI is not proof of API integration |
| Checkout/Paystack UI integration | Not yet implemented/verified | Must follow backend contract |
| Admin integration | Not yet started in this sequence | Preserve existing admin app |
| E2E/accessibility/performance release gates | Not yet verified | Required before production |

---

## 7. Next work — ordered implementation plan

### Immediate task A — finish foundation cleanup

1. Remove the four unused-variable warnings without changing component behaviour.
2. Inspect the root `package.json`, client package files, lockfiles, Next.js config and local `pnpm-workspace.yaml`.
3. Resolve the multiple-lockfiles warning through a deliberate configuration decision; preserve both lockfiles and local backups.
4. Re-run `pnpm lint` and `pnpm build`.
5. Record the results and commit only intended frontend files.

### Task B — API client test foundation

1. Select/configure Vitest and React Testing Library for the existing client package.
2. Add API client tests for:
   - bearer header inclusion and missing-token behaviour;
   - unauthenticated requests;
   - default credentials and explicit `include`;
   - JSON body/header handling;
   - HTTP 204;
   - backend `{ message, errors }` validation/error responses;
   - malformed JSON and non-JSON responses;
   - network failures and non-success HTTP statuses.
3. Ensure tests do not require production credentials or a live database.
4. Run the tests and record actual output.

### Task C — storefront data foundation

1. Configure TanStack React Query and a stable query-client provider.
2. Define centralized query keys and typed feature-level API functions.
3. Add consistent loading, empty, error and retry behaviour.
4. Keep backend-owned data in React Query; reserve Zustand for UI-only state.
5. Add tests for query/mutation behaviour and cache invalidation.

### Task D — secure customer identity and sessions

1. Document customer login, registration, email verification, forgot/reset password, refresh and logout contracts.
2. Design a Next.js server-side BFF/session boundary for refresh-token handling and HttpOnly cookies.
3. Define CSRF and origin protections, cookie settings, expiry, refresh rotation, logout/revocation and session restoration.
4. Keep customer and staff identity/session boundaries separate.
5. Do not ship persistent browser storage of access/refresh tokens.

### Task E — real catalogue integration

1. Map actual product and category routes, query schemas and response types.
2. Replace placeholder catalogue data with backend data.
3. Connect product listing, category browsing, search/filter/sort only where supported, product details, images and variants.
4. Respect backend availability and stock constraints.
5. Apply the ShopSphere design image and palette to all relevant screens.

### Task F — shopping and checkout

1. Integrate customer cart and guest cart separately.
2. Integrate wishlist.
3. Implement address and checkout forms against verified schemas.
4. Keep prices/totals backend-authoritative.
5. Implement Paystack initialization and safe payment-return/recovery handling.
6. Test success, failure, expiry, uncertain outcomes and duplicate submission protection.

### Task G — customer lifecycle and after-sales

Implement supported account, order history/details, delivery tracking, guest order access, returns/evidence, refunds visibility, warranty and notification experiences using verified backend contracts.

### Task H — administration application

After the storefront foundation is stable, review the existing `frontend/admin` app and incrementally integrate staff authentication, permissions, dashboard, products/categories, inventory, orders, fulfilment, deliveries, returns/refunds/warranty, customers, staff, notifications, analytics and chat. Do not replace the existing admin application.

### Task I — production readiness

Complete unit/integration/E2E tests, responsive and cross-browser checks, WCAG 2.2 AA review, security review, performance/Core Web Vitals measurement, error monitoring, staging verification and release approval.

---

## 8. Working agreements for this project

- Keep `frontend/client` and `frontend/admin`; do not rename or replace them.
- Treat the ShopSphere image as the main storefront visual reference.
- Use the existing backend as the source of truth.
- Verify backend contracts before implementing API consumers.
- Do not invent policies, endpoint paths, response properties or payment outcomes.
- Preserve local user files, database dumps and backups.
- Keep changes focused and reviewable in feature branches and PRs.
- Run and report the relevant local checks; never label a feature complete based on appearance alone.
- Keep PR #55 stacked on PR #54 until the prerequisite is reviewed and merged with explicit approval.
- Do not merge PRs or change their base branches without explicit user approval.
- Update this document when a milestone, PR, architectural decision or validation result changes.

---

## 9. Immediate resume point

At the last confirmed local checkpoint, the developer was on branch `feat/storefront-client-foundation`, inside `frontend/client`. The latest API-client commit `04319dc` had been pulled. Local lint and production build passed, with the four lint warnings and multiple-lockfiles warning described above.

**The next action is to inspect the root/client package configuration and the two component files with warnings, then make the minimal cleanup.** Preserve the untracked local workspace YAML and all backend/local backup files while doing so.



---

## 10. Storefront catalogue and ShopSphere implementation checkpoint — 21 November 2026

Implemented on `feat/storefront-client-foundation` after the earlier API transport foundation:

- Replaced the old storefront shell branding and visual treatment with the ShopSphere direction: `#FBF9F6` page surface, `#081C41` navy structure, `#1D52BD` primary blue and `#EC702E` orange accent.
- Reworked the header/navigation, responsive search form, homepage hero, footer, product cards and catalogue layout.
- Removed the hardcoded sample product list and placeholder product detail object.
- Added typed public catalogue access for `GET /products`, `GET /products/:slug` and `GET /categories`.
- Connected search, category, min/max price, pagination and the backend-supported sort values to the public product listing.
- Connected product detail pages to the backend product slug and display of catalogue images, variants, stock and warranty fields.
- Prices are formatted as NGN from backend values; no sample prices, stock levels, product ratings or shipping promises are fabricated.

### Architectural note

Public catalogue reads currently use Next.js server-side fetching with a 60-second revalidation interval. TanStack React Query has deliberately not been added yet: this first milestone is server-rendered public catalogue data, while React Query should be introduced with the subsequent client-interactive authenticated/cart workflows where cache invalidation is needed. The pnpm lockfile has therefore not been modified for a dependency that is not used.

### Explicitly not complete

- Cart mutations and guest/customer cart synchronization.
- Secure persistent customer/staff sessions and the BFF/HttpOnly-cookie boundary.
- Checkout and Paystack payment-return handling.
- Full visual redesign of every remaining route (including cart and account flows).
- Local lint, build, automated test and browser verification of this new checkpoint.

### Current checkpoint

- Latest implementation commit before this progress update: `be5b1bce3c847854900a9c7e642253887fef66c7`.
- PR #55 remains open and stacked on PR #54; no retarget or merge was performed.
- GitHub reported PR #55 mergeable after the latest update. No check runs were reported for the latest implementation commit.
- Next action: pull the latest branch locally, run the client lint/tests/build, verify the API against a running local backend and review the ShopSphere pages at mobile/tablet/desktop widths. Fix any type/API/rendering issues before continuing with cart integration.
