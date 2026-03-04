# Flock Implementation State

Last updated: 2026-03-04

## Purpose

This document is the implementation-truth snapshot for the current Flock pilot build in this repo. It records:

- what has been built
- what was changed from the original extracted backend
- what was tested live
- what is currently production-blocking vs pilot-acceptable

Use this file for "what exists now." Use [FLOCK_ORCHESTRATION_LEDGER.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/FLOCK_ORCHESTRATION_LEDGER.md) for ongoing coordination and next steps.

## PM Source Of Truth

The product source-of-truth pages currently referenced by the PM are:

- Product Flow: https://www.notion.so/316c085c7b9980ab8e47e72e88fe88ce
- Integrations: https://www.notion.so/316c085c7b9980709c3dc790e2036b35

These pages define the intended product and integration direction. This document records what is implemented now, including where the implementation still diverges.

## Interpretation Rule

For this project, fidelity is enforced in this order:

1. PM product flow must be fully represented before public deployment.
2. Real integration cutover must wait until the PM product flow is represented.
3. Backend implementation choices may deviate from PM-preferred vendors/frameworks if the product flow remains faithful.

This means infrastructure and backend-stack shortcuts are acceptable during development, but missing product-flow behavior is not acceptable at launch.

## Product Scope Locked In

Current product scope is a single-venue closed pilot for:

- QR/browser guest queue join
- pre-order while waiting
- deposit capture before seating
- staff OTP login
- staff OTP seating
- guest add-on ordering after seating
- seated bill with deposit deduction
- final payment
- invoice creation

Out of current pilot scope:

- multi-venue onboarding
- fully live POS/TMS dependency
- public launch
- split bills

## New In-Progress Workstream

Phase 6 has moved beyond backend-only groundwork. The current workstream is real multi-user guest collaboration on top of the existing tray shell:

- schema now defines:
  - `PartySession`
  - `PartyParticipant`
  - `PartyBucketItem`
- a new migration is checked in:
  - `20260303121500_party_sessions_phase6a`
- queue join now creates and/or ensures a party session plus an initial host/payer participant
- guest tokens can now include:
  - `partySessionId`
  - `participantId`
- backend routes now exist under `/api/v1/party-sessions` for:
  - invite-token join
  - session summary
  - participant list
  - shared bucket read/update
- the seated guest tray shell now uses the shared `party-sessions` bucket when a `partySession` is present
- the guest UI now includes a visible share/join layer in code:
  - `Invite others`
  - share tray
  - public join route `/v/:slug/session/:joinToken`

So the correct current framing is:
- backend foundation exists
- shared-bucket frontend cutover exists
- public share/join UX exists in code
- remaining work is validation, production parity, and refinement

## Source-Of-Truth Decisions Already Applied

- Active codebase is `C/Flock` only.
- Frontend design source is `C/taurant/flock v2.html` only.
- Legacy `taurant` logic is not reused.
- Backend remains Express + Prisma + Supabase-backed Postgres.
- Frontend is a lightweight SPA served by the backend, not a separate Next/Vercel app.
- Redis is treated as optional for pilot runtime.

## Major Code Changes Completed

## 1. Frontend Added

A new web app was added under:

- [index.html](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/index.html)
- [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css)
- [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js)

This frontend:

- ports the `flock v2.html` visual language
- supports guest and staff flows
- is served directly by the backend
- uses the same-origin API under `/api/v1`

Implemented frontend routes:

- `/`
- `/v/the-barrel-room-koramangala`
- `/v/:slug/e/:entryId`
- `/v/:slug/e/:entryId/preorder`
- `/staff/login`
- `/staff/dashboard`
- `/admin/login`
- `/admin/dashboard`

## 2. Backend Serving Updated

[app.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/app.ts) was updated to:

- serve the `web` directory statically
- fall back to `index.html` for non-API routes
- keep API routes mounted under `/api/v1`

## 3. Queue / Seating / Table State Updated

Key changes:

- [queue.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/queue.service.ts)
- [table.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/table.service.ts)

Implemented behavior:

- queue join generates seating OTP
- queue join calculates position and ETA
- venue queue includes `WAITING`, `NOTIFIED`, and `SEATED`
- seating changes guest to `SEATED`
- seating changes table to `OCCUPIED`
- auto-advance reserves tables and attaches the reserved table to the queue entry
- cancel flow clears reserved tables back to `FREE`
- completion moves table to `CLEARING`

## 4. Pre-Order Sync On Seating

[order.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/order.service.ts) now includes:

- `syncPendingPreOrderForSeating`

[queue.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/queue.service.ts) calls that during seating.

Current behavior:

- if POS outlet is configured, pre-order attempts to sync
- if POS outlet is not configured, response returns `manual_fallback`
- this is acceptable for the current pilot because POS is intentionally manual-first

## 5. Payment Flow Hardened

Key files:

- [payment.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/payment.service.ts)
- [payment.controller.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/controllers/payment.controller.ts)
- [payment.routes.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/routes/payment.routes.ts)

Implemented behavior:

- deposit initiate
- deposit capture
- final payment initiate
- final payment capture
- idempotent-ish capture path via shared payment capture logic
- webhook path for `payment.captured` and `payment.failed`
- offline final settlement path for staff
- invoice generation after final payment

Added route:

- `POST /api/v1/payments/final/settle-offline`

## 6. Redis Degraded Runtime

Key files:

- [redis.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/config/redis.ts)
- [server.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/server.ts)
- [queue.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/queue.service.ts)

Current behavior:

- app attempts Redis connect
- if Redis is unavailable, startup continues
- cache/pubsub operations are skipped safely
- shutdown does not fail when Redis was never ready

This was necessary because no Redis server is running locally and the pilot should still function.

## 7. Controller Validation Fixed

Several controllers originally required UUID-only IDs even though current seeded/static records use string IDs such as:

- `venue_barrel_room`
- `table_t1`
- `item_kf_premium`

These were relaxed from `z.string().uuid()` to non-empty string validation in:

- [auth.controller.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/controllers/auth.controller.ts)
- [queue.controller.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/controllers/queue.controller.ts)
- [order.controller.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/controllers/order.controller.ts)
- [payment.controller.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/controllers/payment.controller.ts)

Without this, the live seeded venue and menu were unusable through the API.

## 8. Dev Rate Limiting Relaxed

[app.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/app.ts) now applies the global API limiter and OTP limiter only in production.

Reason:

- during active local testing, the limiter was blocking normal flow validation from the same machine/IP

Current effect:

- development is unblocked
- production still needs real rate limiting enabled

## 9. Schema And Database State Established

Supabase project is connected and was used to apply the schema and seed data.

Checked-in migrations:

- [20260302120000_init_flock_schema/migration.sql](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/prisma/migrations/20260302120000_init_flock_schema/migration.sql)
- [20260302121500_enable_rls_public_tables/migration.sql](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/prisma/migrations/20260302121500_enable_rls_public_tables/migration.sql)

Current database state includes:

- 1 venue
- 3 staff users
- 10 tables
- 2 menu categories
- 7 menu items

## 10. Security Baseline Applied

RLS was enabled on all public tables in Supabase.

Important limitation:

- RLS is enabled, but there are currently no explicit policies
- this is safer than fully open tables, but still incomplete production hardening

## 11. Deployment Prep Added

Deployment-prep artifacts were added so the project can move from local-only runtime toward a stable pilot host.

New files:

- [render.yaml](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/render.yaml)
- [PILOT_DEPLOYMENT_RUNBOOK.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/PILOT_DEPLOYMENT_RUNBOOK.md)

README was also updated to point to these deployment artifacts:

- [README.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/README.md)

Current deployment stance:

- Render is the preferred first stable host for the current combined Express app
- Vercel is not the preferred primary host unless frontend and backend are split later

## 12. Phase 1 PM-Faithful Seated Ordering Added

The main PM product-flow gap is now implemented in code.

Backend additions:

- queue join now returns a `guestToken`
- new guest session recovery route exists:
  - `POST /api/v1/queue/:entryId/session`
- new guest table-order route exists:
  - `POST /api/v1/orders/table/guest`
- JWT payloads now support:
  - `kind: 'staff'`
  - `kind: 'guest'`
- guest auth middleware exists and binds the guest token to a single queue entry
- staff and guest table-order flows now share the same order-creation + POS-fallback path

Frontend additions:

- guest session state is now stored per queue entry in local storage
- seated guest view no longer runs in lean-only mode
- the seated guest can:
  - recover the guest session with OTP if local storage is missing
  - build a separate table-order cart
  - submit multiple add-on table orders while seated
- the seated bill remains powered by:
  - `GET /api/v1/orders/bill/:queueEntryId`
- the staff `Seat OTP` form now preserves operator input on failed attempts and shows errors inline instead of wiping the form state on rerender

Implementation note:

- this closes the product-flow gap in code even though the auth vendor choice is still custom JWT for now
- that backend deviation remains acceptable under the current interpretation rule

## 13. Phase 2 `flock v2.html` Flow Parity Added

The next layer of `flock v2.html` parity is now implemented in code while explicitly preserving the PM-validated deposit-first payment flow.

Backend additions:

- new admin-safe menu read route:
  - `GET /api/v1/menu/admin/current`
- `POST /api/v1/menu/items` now accepts seeded string category IDs such as `cat_drinks`
- menu update/delete paths now verify the target item belongs to the authenticated venue before mutating it
- `PATCH /api/v1/menu/items/:itemId/toggle` now requires manager/owner role access
- new recent table-event route:
  - `GET /api/v1/tables/events/recent`

Frontend additions:

- home route now restores the separate `Admin` role card
- admin login and admin dashboard are now implemented
- admin dashboard supports:
  - grouped menu view
  - live item enable/disable
  - item removal
  - category creation
  - item creation
- staff dashboard now has five functional tabs:
  - `Queue`
  - `Seated`
  - `Tables`
  - `Seat OTP`
  - `Manager`
- queue rows now show:
  - guest OTP
  - ETA
  - deposit / pre-order markers
  - PM-safe quick-seat action that preloads OTP and best-fit table into the seat flow
- `Seat OTP` now uses a 6-box verification interaction with paste support
- tables tab now includes a backend-driven recent floor event feed
- seated guest ordering now stays menu-forward even when the guest token is missing:
  - menu remains visible
  - controls lock visually
  - OTP recovery sits inline in the same ordering section
- completed guest state now includes a `Done` action that clears guest local state and returns to the venue route

Validation:

- `node --check web/app.js` passes
- `npm run build` passes after the Phase 2 changes
- live API validation completed on the running app at `http://localhost:3001`:
  - manager OTP auth still succeeds
  - `GET /api/v1/menu/admin/current` returns grouped menu data
  - `GET /api/v1/tables/events/recent` returns recent venue-scoped floor events
  - `GET /api/v1/queue/live` now returns the richer payload required by the new staff UI, including:
    - `otp`
    - `table`
    - `orders`
- admin menu operations were exercised end to end with temporary test data:
  - category create
  - item create
  - item toggle
  - item delete
  - test category cleanup

## 14. Phase 3 Deployment Hardening Started

The first deployment-hardening tranche is now implemented in code and in the connected Supabase project.

Runtime and env changes:

- production CORS origins are now environment-driven via:
  - `APP_ALLOWED_ORIGINS`
- production now enables `trust proxy` so Render-hosted rate limiting uses the correct client IP chain
- production rate limiting now uses the shared limiter middleware instead of ad hoc inline limiter definitions
- `REDIS_URL` is now truly optional:
  - if omitted, Redis is disabled cleanly
  - the app no longer falls back to an implicit localhost Redis target
- a local [`.gitignore`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/.gitignore) now keeps `.env` local-only while `.env.example` remains the deployment template

Deployment artifact changes:

- [`render.yaml`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/render.yaml) now includes:
  - `APP_ALLOWED_ORIGINS`
- [`.env.example`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/.env.example) now documents:
  - `APP_ALLOWED_ORIGINS`
  - optional Redis for degraded mode
  - hosted smoke-test mock defaults

Security changes:

- added checked-in migration:
  - [20260302170000_harden_public_rls_policies/migration.sql](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/prisma/migrations/20260302170000_harden_public_rls_policies/migration.sql)
- applied the same RLS hardening migration to the connected Supabase project
- the migration:
  - revokes `anon` and `authenticated` access to the `public` schema
  - revokes table access for `anon` and `authenticated`
  - adds explicit restrictive deny policies across all Flock public tables

Validation:

- `npm run build` passes after the deployment-hardening code changes
- Supabase security advisors return no findings after the RLS hardening rollout
- a local Render-like smoke boot was validated:
  - production mode boot on port `10000`
  - `APP_ALLOWED_ORIGINS` set
  - `REDIS_URL` omitted
  - all mock flags enabled
  - `/api/v1/health` returned `ok`
  - `/admin/login` returned `200`

Operational artifact added:

- [RENDER_SMOKE_RELEASE_SHEET.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/RENDER_SMOKE_RELEASE_SHEET.md)

## Live Test Results (Validated)

Date tested: 2026-03-02

Server runtime used:

- local Node server
- running on `http://localhost:3001`

Reason for `3001`:

- `3000` was already occupied by another Node process on the machine

## Guest flow validated

Validated sequence:

1. Guest joined queue successfully
2. Guest received queue entry ID, OTP, position, ETA
3. Guest created a pre-order successfully
4. Guest initiated and captured deposit payment in mock mode
5. Guest state reflected `depositPaid` and `preOrderTotal`
6. After staff seating, guest state reflected `SEATED` and attached table
7. Guest bill endpoint returned correct subtotal, GST, deposit paid, and balance due
8. Guest initiated and captured final payment in mock mode
9. Guest state moved to `COMPLETED`

Concrete validated test values:

- queue entry: `62683f18-7fc2-40e3-9873-9d298243f637`
- guest OTP: `315434`
- pre-order: `90100` paise total
- deposit: `67575`
- final balance: `22525`

## Phase 1 validation added

Date tested: 2026-03-02

The new Phase 1 product-flow work was validated against the running local API on `localhost:3001` for the newly added auth and guardrail paths.

Validated:

1. Queue join now returns `guestToken`
2. Guest session recovery returns a fresh `guestToken`
3. Guest table-order route rejects valid guest tokens when the guest is not yet seated
4. Guest table-order route rejects requests when the token does not match the submitted `queueEntryId`

Concrete validated test values:

- queue entry: `1d576a79-1e86-405f-a3da-a30a3eec8c49`
- seating OTP: `582219`

This validation is now complete for both required seated branches.

Additional validated flows:

### No-preorder seated branch

Validated sequence:

1. Guest joined queue and received `guestToken`
2. Staff seated the guest
3. Guest placed a table order through `POST /api/v1/orders/table/guest`
4. Bill reflected the table order with:
   - no deposit
   - full balance due
5. Final payment completed
6. Queue entry moved to `COMPLETED`
7. Table moved to `CLEARING`

Concrete validated values:

- queue entry: `f16cf84c-3e55-480c-9c0c-02babe441f7f`
- table: `table_t2`
- table order: `20fa16c9-489c-4dc6-83c9-2b3538bcae47`
- total bill: `37800`
- deposit paid: `0`
- final balance: `37800`

### Prepaid seated branch

Validated sequence:

1. Guest joined queue and received `guestToken`
2. Guest created a pre-order
3. Guest initiated and captured deposit
4. Staff seated the guest
5. Guest placed an add-on table order through `POST /api/v1/orders/table/guest`
6. Bill reflected:
   - pre-order
   - table order
   - deposit deduction
7. Final payment completed
8. Queue entry moved to `COMPLETED`
9. Table moved to `CLEARING`

Concrete validated values:

- queue entry: `40f003a2-afb7-40d6-94db-cc70b2ec0c9e`
- pre-order: `c98f2c50-3539-492c-88a0-6090cc97e1f3`
- deposit paid: `43238`
- add-on table order: `7d3eecf5-7762-4fc7-b058-821d73f9b4b1`
- combined bill: `67100`
- final balance: `23862`
- table: `table_t3`

## Staff flow validated

Validated sequence:

1. Staff OTP send worked
2. Staff OTP verify returned a valid JWT
3. Staff queue view returned active entries
4. Staff tables view returned live table states
5. Staff seated guest by guest OTP and table ID
6. Pre-order sync returned `manual_fallback` as expected under manual POS mode
7. After final payment, table moved to `CLEARING`

Validated staff identity:

- `Priya Nair`
- role `MANAGER`
- phone `9000000002`

## Financial completion validated

After final payment:

- queue entry moved to `COMPLETED`
- table `T1` moved to `CLEARING`
- invoice was created in Supabase

Validated invoice:

- `FLOCK/2026-27/00001`

## Current Runtime Configuration

Current local runtime characteristics:

- server runs on `localhost:3001`
- Supabase session pooler is used in local `.env`
- Redis is not running
- app continues in degraded mode without Redis
- payments are still mock-mode
- notifications are still mock-mode

## Known Gaps Before Restaurant Pilot

These are the main remaining real-world blockers:

## 1. Real integrations still mocked

Current flags still need to be changed for live pilot:

- `USE_MOCK_PAYMENTS=false`
- `USE_MOCK_NOTIFICATIONS=false`

## 2. No production RLS policies yet

RLS is enabled but policies are not written.

Need:

- explicit service-role/backend-only policy strategy
- or explicit app-role policies if using Supabase API surfaces directly

## 3. Stable public URL exists, but deployment parity remains a concern

The app is deployed publicly at:

- `https://taurant.onrender.com`

However, the important remaining gap is not “no deployment.” It is:

- local code can move ahead of the last manual Render deploy
- production parity must be checked by commit, not assumed
- the currently verified live commit is:
  - `4af4271`

Need:

- a deliberate check of which local changes are still waiting for manual deploy
- continued webhook reachability verification for Razorpay after each deploy
- confirmation that user-facing share/join and later local UX fixes are reflected in the specific live commit you are testing

## 4. Current backend is not ideal for Vercel-only deployment

Because the app currently depends on:

- an Express server
- long-lived process assumptions
- background poller behavior

Preferred deployment target is a persistent Node host rather than Vercel-only serverless hosting.

## 5. Redis is absent

Pilot can run without Redis, but:

- no cache/pubsub
- more load on DB
- not ideal for scale

This is acceptable for a tightly managed single-venue pilot.

## 6. Menu and venue setup are still seed-like

The current menu and venue data are functional, but still sample/demo-oriented.

Before restaurant pilot:

- load the real menu
- verify actual deposit %
- verify real table layout

## Recommended Immediate Next Moves

1. Run one full happy-path validation of the new seated guest-ordering flow.
2. Only after that, deploy the Express app to a stable HTTPS host.
3. Configure real Razorpay keys and webhook.
4. Configure real Gupshup (and SMS fallback if needed).
5. Load the restaurant's real menu and tables.
6. Write minimum required RLS policies.

## PM Fidelity Gaps (Audit Against Notion Pages)

The current repo is not yet 100% faithful to the PM source-of-truth. The major gaps are:

## 1. Staff/admin auth stack diverges

PM source truth requires:

- Firebase Auth for staff/admin login

Current implementation uses:

- custom phone OTP + JWT

Relevant code:

- [jwt.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/utils/jwt.ts)
- [auth.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/middleware/auth.ts)

Impact:

- staff login works, but the auth architecture is not faithful to the PM integration spec
- under the current interpretation rule, this is acceptable for now unless it blocks PM product-flow behavior

## 2. Seated guest self-ordering is implemented and validated

PM source truth explicitly includes:

- guest adds more items at table after seating

Current implementation now includes:

- guest session token issuance on queue join
- guest session recovery by OTP
- guest-auth table-order endpoint
- seated guest self-serve table-order UI

Relevant code:

- [order.routes.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/routes/order.routes.ts)
- [queue.routes.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/routes/queue.routes.ts)
- [auth.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/middleware/auth.ts)
- [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js)

Impact:

- the product-flow gap is now closed in code
- the product-flow gap is also validated in live local API execution for:
  - no-preorder seated guests
  - prepaid seated guests
- this means PM product-flow parity is now materially satisfied for the core guest/staff lifecycle, subject to any additional PM steps outside this path

## 3. Hosting direction diverges

PM source truth requires:

- AWS Mumbai as primary hosting

Current repo guidance added for speed:

- Render-first deployment shortcut

Relevant docs:

- [PILOT_DEPLOYMENT_RUNBOOK.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/PILOT_DEPLOYMENT_RUNBOOK.md)

Impact:

- Render is acceptable as a fast pilot shortcut, but it is not fully faithful to the stated infra target
- under the current interpretation rule, this does not block continued product-flow development

## 4. Real-time layer is not live yet

PM source truth expects:

- Upstash first, then ElastiCache

Current implementation:

- Redis abstraction exists
- runtime degrades cleanly without Redis
- no live Upstash connection is configured right now

Impact:

- operationally acceptable for local validation, not fully faithful to the intended month-1 integration stack
- under the current interpretation rule, this is acceptable until product-flow parity is complete

## 5. GST invoice timing may diverge

PM product notes state that invoice / IRN generation is required at payment time for applicable venues.

Current implementation:

- invoice is generated after final payment completion
- no deposit-time invoice generation path exists

Relevant code:

- [payment.service.ts](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/src/services/payment.service.ts)

Impact:

- the current checkout flow is functional, but invoice timing may not match the PM's intended financial/compliance behavior

## 6. Notifications and payments are still mocked

PM source truth assumes live integration paths for the launch stack.

Current implementation:

- integration adapters exist
- local validation was completed in mock mode

Impact:

- architecture is directionally aligned, but not yet operationally faithful until mock mode is removed for pilot
- these must stay mocked until PM product-flow fidelity is complete

## Phase 4 hardening status

The Phase 4 reliability and security pass is now implemented in code.

What changed:

- `QueueEntry` now has durable table-ready deadline fields:
  - `tableReadyDeadlineAt`
  - `tableReadyExpiredAt`
- `Venue` now has:
  - `invoiceSequence`
- the TMS/background poller now sweeps expired `NOTIFIED` entries and releases `RESERVED` tables based on DB deadlines instead of in-memory timeout authority
- deposit and final payment initiation now reuse existing pending payments and reject duplicate already-captured initiation attempts
- queue cancellation now attempts automatic refund of the latest captured, non-cancelled deposit and returns structured refund outcome
- guest-owned queue reads, bill reads, preorder creation, and payment initiation are now guest-token protected after bootstrap
- ordinary `GET /queue/:entryId` responses no longer return the seating OTP
- guest token TTL is now split from staff token TTL via `GUEST_JWT_EXPIRES_IN`
- duplicate preorder cleanup is now documented in:
  - [`PHASE4_DATA_REMEDIATION.sql`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/PHASE4_DATA_REMEDIATION.sql)

Environment status:

- the schema migration for Phase 4 was applied to the connected Supabase project
- the known duplicate preorder corruption on queue entry `1f2c4ae7-19d0-431d-adc8-7c159c3a9d95` was remediated in Supabase

Validation:

- `npx prisma generate` succeeded
- `npm run build` succeeded

## Flock v2 feedback-response status

The next review-response pass is now implemented locally in code, but not yet deployed.

Implemented:

- `tryAdvanceQueue` now loads the venue before reserving the table so venue-specific `tableReadyWindowMin` is honored
- `GET /api/v1/venues/stats/today` is no longer shadowed by `/:slug`
- `GET /api/v1/menu/admin/current` now returns the SPA-compatible shape:
  - `{ categories: [...] }`
- table-order POS/manual fallback now uses the table label instead of the raw table UUID
- `getVenueStats` no longer mutates the `now` `Date`
- `/api/v1/health` now checks Postgres and reports Redis as `ok` or `degraded`
- production logging is now console-only
- `POST /api/v1/venues` is now protected by `x-flock-onboarding-token`
- the SPA now:
  - lazy-loads Razorpay checkout
  - stops guest polling in `SEATED`
  - fetches seated bills only on the `Seated` staff tab, at a 10-second cadence
  - adds submit guards/loading labels for guest queue join, restore, preorder, table-order, and final-pay actions
  - unwraps structured client/API errors more safely so fatal screens do not show `[object Object]`
- retention tooling now exists in:
  - [`prune_operational_data.ts`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/scripts/prune_operational_data.ts)

Schema hardening prepared locally:

- `QueueEntry` now declares:
  - `@@index([status, tableReadyDeadlineAt])`
- `Notification.status` now uses `NotificationStatus`
- `MenuItem` now declares:
  - `@@unique([venueId, name])`
- migration added:
  - [`migration.sql`](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/prisma/migrations/20260303093000_v2_feedback_hardening/migration.sql)

Still pending after this local pass:

- apply the new migration to Supabase
- redeploy Render so the hosted app reflects these changes

## Phase 5A guest UX status

The next guest UX pass is now implemented locally and build-clean, but not yet deployed.

Implemented:

- the seated guest experience now uses a mobile-first tray shell instead of one long stacked scroll:
  - `Menu`
  - `Your Bucket`
  - `Ordered`
- the seated draft cart has been refactored behind a local `BucketStore` abstraction
- a fixed bottom guest tray nav now drives seated guest navigation
- a floating `Pay {balance}` CTA is now rendered for seated guests with an outstanding balance
- guest menu browsing now includes sticky category pills and category-targeted sections
- seated local interactions no longer force full guest-route rerenders for:
  - tray switching
  - menu quantity changes
  - bucket edits
- the pre-order page now has:
  - a desktop sticky summary card
  - a mobile sticky summary/action dock
- the scope remains UX-only:
  - no backend API changes
  - no schema changes
  - no sharing/QR/multi-user behavior added

Validation:

- `node --check web/app.js` succeeded
- `npm run build` succeeded

Still pending:

- browser validation of the new seated guest shell on mobile-sized viewports
- deploy the updated frontend to Render

Follow-up local UX/stability fixes after first browser pass:

- category-tab taps in the seated `Menu` tray no longer force an immediate tray rerender after scroll
- sticky category tabs were adjusted for better mobile visibility below the header
- category section headings now use higher-contrast text
- the `Your Bucket` tray now supports:
  - quantity increment/decrement
  - explicit item removal
- transient guest-entry fetch failures no longer clear the guest token by default; only auth-like failures force restore
- the guest route now shows a retryable “session unavailable” state for temporary server issues
- staff stats are now cached/throttled in the SPA and `/venues/stats/today` failures no longer tear down the whole dashboard
- mobile tabs now scroll horizontally instead of wrapping into a hard-to-use multi-row block

Validation:

- `node --check web/app.js` succeeded
- `npm run build` succeeded after the follow-up patch

## Phase 6B shared bucket status

The first real multi-user guest slice is now implemented locally and build-clean.

Implemented:

- the existing seated tray shell (`Menu / Your Bucket / Ordered`) now uses the existing backend `party-sessions` APIs when a `partySession` is present on the queue entry
- local seated bucket state has been replaced by a session-backed in-memory cart:
  - `GET /party-sessions/:id/bucket`
  - `PUT /party-sessions/:id/bucket`
- quantity changes in `Menu` and `Your Bucket` are now:
  - optimistic
  - debounced
  - synced back to the shared bucket
- compact seated-only polling now keeps cross-device state in sync using:
  - `GET /party-sessions/:id/bucket`
  - `GET /party-sessions/:id/participants`
- the seated guest shell now shows a compact participant-count line
- `Your Bucket` now correctly describes the draft round as shared across the active table session
- successful `Send order to table` clears the shared bucket after order submission
- a developer-only local test helper now exists:
  - `window.__flockJoinPartySession(joinToken, displayName)`

Validation:

- `node --check web/app.js` succeeded
- `npm run build` succeeded

Still pending:

- This section originally described the first shared-bucket cutover before invite/share UX existed.
- That earlier “no visible invite/share UI yet” statement is now obsolete and is superseded by the Phase 6C note below.

## Phase 6C public share/join status

The visible multi-user share/join layer is now implemented in the frontend codebase.

Current frontend behavior in `web/app.js`:

- active guest states (`WAITING`, `NOTIFIED`, `SEATED`) can show:
  - `Invite others`
- a visible share tray exists
- the share tray can generate:
  - a copyable invite link
  - a QR backed by the app-side QR proxy endpoint
- a public frontend join route exists:
  - `/v/:slug/session/:joinToken`
- the join route:
  - collects a display name
  - calls the existing backend `POST /api/v1/party-sessions/join/:joinToken`
  - stores the returned guest token
  - redirects into the normal guest route:
    - `/v/:slug/e/:queueEntryId`

The current code therefore goes beyond “backend-only” or “developer-only” multi-user.

## Deployment reality re-baseline (verified 2026-03-04)

The current live Render deployment was rechecked and is:

- service: `taurant`
- URL: `https://taurant.onrender.com`
- live deploy: `dep-d6jrcmklsarc73cu4nf0`
- live commit: `4af4271`

Because commit `4af4271` is newer than `96f996c` (`Add shared session UX and QR proxy preload`), production should include the visible share/join layer that was introduced in that commit line.

## Still uncertain

One important infrastructure item remains unverified from this session:

- whether the `20260303093000_v2_feedback_hardening` migration was applied to Supabase

Reason:

- Supabase MCP is not currently usable in this session (`Auth required`)
- direct DB verification from this shell failed because the Supabase session-pool host was unreachable from this environment

So the correct documentation stance is:

- share/join frontend deployment status: verified by Render commit lineage
- `20260303093000_v2_feedback_hardening` database application status: still not independently re-verified here
- no payer-role gating yet
- local browser verification in two tabs/devices is still the next practical check before relying on the share/join flow for pilot operations

## Phase 6 UX runtime audit status (2026-03-04)

A browser-driven UX/runtime pass was completed against the live Render deployment using Chrome DevTools MCP.

Environment used:

- live URL: `https://taurant.onrender.com`
- live deploy: `dep-d6jrcmklsarc73cu4nf0`
- live commit lineage: `4af4271`
- devices tested:
  - Pixel-sized viewport
  - iPhone-sized viewport

Confirmed working on the live build:

- guest queue join succeeds
- waiting-state guest route renders cleanly on both tested mobile widths
- visible `Invite others` is present
- the share tray opens and the QR renders through `/api/v1/share/qr`
- a second participant can join successfully through the public join route
- invalid join tokens produce a clear inline error
- staff/admin OTP send flows respond successfully
- invalid staff OTP produces a clear inline error
- no console errors were observed during the tested flows

Confirmed runtime issue on the live build:

- the guest `Pre-order now` path is currently broken on Render:
  - the URL changes to `/v/:slug/e/:entryId/preorder`
  - the page still renders the waiting-state guest screen instead of the pre-order UI

Confirmed live performance issue:

- waiting-state guest pages repeatedly refetch `/api/v1/share/qr` while idle because the QR preload is tied to repeated guest rerenders

Likely code-level issue (not fully runtime-blocking, but still real drift):

- typography/branding migration is incomplete:
  - `web/index.html` imports `Fraunces` + `DM Sans`
  - `web/styles.css` still contains multiple `Instrument Serif` declarations

Still not testable in this session:

- the local repo build could not be browser-validated because Prisma could not reach the Supabase pooler from this shell
- staff/admin dashboard internals remain untested because OTP verification could not be completed in-session
- seated tray-shell runtime validation remains incomplete because seating requires staff auth
- shared seated-bucket sync, participant count in seated mode, and final-payment CTA behavior are therefore still not runtime-confirmed here

Detailed audit write-up:

- `docs/UX_TEST_AUDIT_PHASE6.md`

## Phase 6 UX hotfix patch status (local, not yet deployed)

After the live UX audit identified the most immediate guest-flow regressions, a focused local frontend patch was applied.

Local code changes:

- `web/app.js`
  - clears pending refresh timers before SPA route transitions
  - makes the `/v/:slug/e/:entryId/preorder` route check explicit and evaluates it before the base guest-entry route
  - caches QR preloads by invite URL so waiting-state rerenders stop forcing repeated `/api/v1/share/qr` fetches
- `web/styles.css`
  - changes the narrow-width share-tray link row to a stacked layout
  - allows the invite-link preview to wrap on mobile instead of truncating aggressively

Validation:

- `node --check web/app.js` succeeded
- `npm run build` succeeded

Important deployment note:

- this hotfix is only in the local repo right now
- the current live Render deployment still needs a manual deploy before the fixes can be verified in production

## Post-deploy verification status (same-day re-test)

After the first manual Render deploy of the Phase 6 UX hotfix commit, a focused production re-test was run against `https://taurant.onrender.com`.

Confirmed live:

- the QR prefetch churn fix is active in production
  - repeated idle `/api/v1/share/qr` fetches were no longer observed
- the narrow-mobile share tray layout fix is active in production
  - the invite-link preview wraps
  - the `Copy` button stacks below the preview on iPhone-width screens

Still broken in production:

- the guest pre-order route still renders the waiting-state guest screen even on `/v/:slug/e/:entryId/preorder`

Root cause now identified:

- `closeShareSheet()` still force-rendered `renderGuestEntry(...)`
- because `renderRoute()` begins by calling `closeShareSheet({ keepState: false })`, the pre-order route was being overwritten back into the guest-entry view

Follow-up local-only fix applied:

- removed the forced `renderGuestEntry(...)` side effect from `closeShareSheet()`

Validation:

- `node --check web/app.js` succeeded
- `npm run build` succeeded

Current deployment note:

- the first UX hotfix deploy is partially verified live
- the second pre-order fix is still local only and requires one more push + manual Render deploy before production can be re-tested
