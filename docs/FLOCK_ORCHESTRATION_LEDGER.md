# Flock Orchestration Ledger

Last updated: 2026-03-02
Status: active

## Purpose

This is the live coordination ledger for the Flock pilot project.

It is the required writeback target for substantive project work. Skills are static instructions; this file is the mutable project memory that keeps future sessions aligned with current reality.

Use this file to track:

- current project state
- locked decisions
- completed work
- evidence
- open risks
- next steps
- running change log

## Project Truth Hierarchy

Use sources in this order when they conflict:

1. PM source-of-truth pages:
   - `Product Flow` https://www.notion.so/316c085c7b9980ab8e47e72e88fe88ce
   - `Integrations` https://www.notion.so/316c085c7b9980709c3dc790e2036b35
2. Current code in `C/Flock`
3. This ledger
4. Supporting implementation docs in `C/Flock/docs`
5. Historical local notes / `taurant`

For frontend design only:

1. `C/taurant/flock v2.html`

## Current Objective

Ship a single-venue closed pilot for Flock that proves:

- queue join
- pre-order
- deposit
- seating
- guest add-on table ordering after seating
- final payment
- invoice creation

without disrupting restaurant floor operations.

## Locked Decisions

- Active product codebase: `C/Flock`
- Frontend design source: `C/taurant/flock v2.html` only
- Legacy `taurant` logic is excluded
- Backend remains Express + Prisma
- Database is Supabase Postgres
- Frontend is served by the backend for now
- Redis is optional for pilot runtime
- Pilot is single-venue only
- POS/TMS are manual-fallback first
- Guest add-on table ordering after seating is now part of the required pilot flow
- Local validated runtime port is `3001`
- Backend architecture may deviate from PM implementation preferences if needed.
- Product flow may not deviate from PM source-of-truth before public deployment.
- No public URL push or real integration cutover until the PM product flow is fully represented in the product.

## Current State Snapshot

## Application

- Backend compiles and runs
- Web frontend exists and is served by the backend
- Core queue -> pre-order -> seat -> pay lifecycle is validated
- Phase 1 PM-flow changes are implemented:
  - guest session tokens on queue join
  - guest session recovery by OTP
  - guest-auth table-order endpoint
  - seated guest self-serve ordering UI
- Phase 2 `flock v2.html` parity work is now implemented in code:
  - separate Admin role card, login, and dashboard
  - staff `Seated` tab
  - richer queue rows with quick-seat prefill
  - 6-box seat-OTP entry
  - tables event feed from backend table events
  - seated guest menu stays visible even when guest-token recovery is required
- New Phase 1 code compiles, and the live local API confirms:
  - queue join returns `guestToken`
  - guest session recovery returns a fresh `guestToken`
  - guest table-order endpoint enforces token binding and seated-only ordering
- The full seated happy path is now validated for both branches:
  - no-preorder seated guest branch
  - prepaid seated guest branch

## Database

- Supabase schema is applied
- Seeded venue exists
- RLS enabled across public tables
- RLS policies still missing

## Integrations

- Payments are still mock-mode
- Notifications are still mock-mode
- POS remains manual fallback
- Redis is absent and non-fatal
- Phase 3 deployment hardening is now partially implemented:
  - production CORS origins are env-driven
  - proxy-aware production rate limiting is in place
  - Redis can now be omitted without a localhost fallback
  - explicit RLS hardening migration is checked in and applied

## Deployment

- No stable public deployment yet
- Current proven runtime is local only

## Completed Work

## Repo and architecture

- Established `C/Flock` as the active project
- Added SPA frontend under `web/`
- Stopped using `taurant` logic as implementation source
- Added repo-local Flock orchestration artifacts:
  - `docs/FLOCK_IMPLEMENTATION_STATE.md`
  - `docs/FLOCK_ORCHESTRATION_LEDGER.md`
  - `.codex/skills/flock-orchestrator/`
- Pushed the initial external ledger snapshot to Notion:
  - `https://www.notion.so/317c085c7b9981e78d86c0f085363a4a`
- Added deployment-prep artifacts:
  - `render.yaml`
  - `docs/PILOT_DEPLOYMENT_RUNBOOK.md`
  - README deployment guidance
- Added Phase 2 backend and frontend parity work:
  - menu admin route and venue-safe menu mutations
  - recent venue table-events endpoint
  - admin dashboard menu operations UI
  - staff seated-ops UI, queue quick-seat, and improved seat verification UX
  - guest seated ordering surface now stays menu-forward with inline unlock

## Backend hardening

- Fixed stale menu service
- Added offline final settlement endpoint
- Fixed webhook handling path
- Made Redis non-fatal
- Relaxed invalid UUID-only controller assumptions to match actual app IDs
- Disabled dev rate limiting for local validation

## Database and security

- Applied full Prisma schema to Supabase
- Seeded venue, staff, tables, and menu
- Enabled RLS on all public tables
- Checked migrations into repo

## Live flow validation

- Guest join validated
- Guest pre-order validated
- Deposit capture validated (mock)
- Staff OTP login validated
- Staff queue/table views validated
- Staff seating validated
- Final payment validated (mock)
- Invoice creation validated
- Table transition to `CLEARING` validated

## Validated Evidence

- App running at `http://localhost:3001`
- Venue route works for `the-barrel-room-koramangala`
- Test guest completed:
  - queue entry `62683f18-7fc2-40e3-9873-9d298243f637`
  - status `COMPLETED`
- Test invoice created:
  - `FLOCK/2026-27/00001`
- Manager OTP verification works for:
  - `9000000002`

## Risks / Gaps

## Immediate pilot blockers

- No public HTTPS deployment
- Razorpay still mocked
- Gupshup/WhatsApp still mocked
- No public HTTPS deployment
- Current staff/admin auth stack is not faithful to PM source truth (`Firebase Auth` required there)
- Real integrations are still mocked
- Staff/admin auth still uses custom JWT rather than PM-preferred Firebase Auth

## Operational constraints

- Redis not running
- Port `3000` already occupied on local machine
- Current test data is mixed with seed/demo data

## Integration constraints

- POS sync falls back to manual mode unless outlet config is added
- Webhooks cannot be fully validated until public URL is live

## Next Concrete Steps

## Highest priority

1. Close the PM product-flow fidelity gaps before any public deployment:
   - Phase 1 PM seated guest ordering is validated
   - Phase 2 `flock v2.html` parity is now implemented and needs live browser validation
   - keep PM product flow locked while moving toward deployment
2. Only after product flow is faithful:
   - deploy the app to a stable HTTPS host
   - configure real Razorpay keys and webhook endpoint
   - configure real Gupshup templates and credentials
3. Replace demo venue/menu data with the restaurant's actual data.
4. Deploy the hardened build to Render and validate the hosted smoke release.
5. Treat backend implementation-stack deviations as acceptable unless they break the PM product flow itself.

## Second priority

1. Clean out transient test queue/order/payment data before pilot.
2. Decide whether to keep backend + frontend together or split frontend later.
3. Add a basic operator checklist for service-time usage.

## Turn Operating Contract

Any future substantive work on Flock should:

1. Read this ledger first
2. Read [FLOCK_IMPLEMENTATION_STATE.md](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/docs/FLOCK_IMPLEMENTATION_STATE.md)
3. Perform the requested task
4. Append a change-log entry here
5. Update any locked decisions or next steps that changed

## Change Log

### 2026-03-02

- Established `C/Flock` as the active project.
- Added the new frontend based on `flock v2.html`.
- Hardened queue, seating, payment, and webhook flows.
- Connected Supabase and applied schema.
- Seeded pilot data.
- Enabled RLS.
- Made Redis optional.
- Validated the full core flow live on `localhost:3001`.
- Added this ledger and the paired implementation state document.
- Added a repo-local `flock-orchestrator` skill to enforce ledger-first coordination.
- Attempted Notion sync, but the current Notion MCP session is blocked by missing auth and needs re-authentication before page creation can proceed.
- Completed Notion auth and created the first workspace-level `Flock Orchestration Ledger` page.
- Added Render deployment scaffolding and a pilot deployment runbook as the first concrete step toward a stable public pilot URL.
- Audited the PM `Product Flow` and `Integrations` Notion pages and recorded the remaining fidelity gaps explicitly in the repo docs and ledger.
- Locked a new rule: backend implementation may deviate, but PM product flow cannot deviate before public URL deployment or real integration cutover.
- Implemented Phase 1 PM-flow work:
  - queue join now returns a guest session token
  - `POST /queue/:entryId/session` reissues a guest token using the seating OTP
  - `POST /orders/table/guest` allows guest-authorized table ordering
  - seated guest UI now exposes add-on ordering instead of lean seated mode
- Validated the new Phase 1 paths against the running local API:
  - queue join returned `guestToken`
  - guest session recovery returned a fresh token
  - guest-order endpoint correctly rejected non-seated ordering
  - guest-order endpoint correctly rejected cross-entry token misuse
- Completed full API-only Phase 1 validation for both seated branches:
  - No-preorder branch:
    - queue entry `f16cf84c-3e55-480c-9c0c-02babe441f7f`
    - seated on `table_t2`
    - guest table order `20fa16c9-489c-4dc6-83c9-2b3538bcae47`
    - bill `37800`, deposit `0`, balance `37800`
    - final payment captured
    - queue entry moved to `COMPLETED`
    - table moved to `CLEARING`
- Patched the staff `Seat OTP` UX so the form no longer feels broken during local ops:
  - seat-form state now persists in client UI state
  - failed seat attempts preserve the typed guest OTP
  - failed seat attempts preserve the selected table
  - the exact backend error is shown inline on the same card
  - the submit button disables while the request is in flight
  - the 3-second background auto-refresh is paused on the `Seat OTP` tab to avoid wiping active operator input
  - Prepaid branch:
    - queue entry `40f003a2-afb7-40d6-94db-cc70b2ec0c9e`
    - pre-order `c98f2c50-3539-492c-88a0-6090cc97e1f3`
    - deposit captured `43238`
    - seated on `table_t3`
    - guest add-on order `7d3eecf5-7762-4fc7-b058-821d73f9b4b1`
    - combined bill `67100`, deposit `43238`, balance `23862`
    - final payment captured
    - queue entry moved to `COMPLETED`
    - table moved to `CLEARING`
- Implemented Phase 2 `flock v2.html` parity changes in the codebase:
  - Added `GET /api/v1/menu/admin/current` and hardened menu mutations to be venue-scoped.
  - Relaxed menu item creation so seeded string category IDs are accepted.
  - Added `GET /api/v1/tables/events/recent` for venue-scoped floor-event feeds.
  - Added `/admin/login` and `/admin/dashboard` in the SPA.
  - Restored the `Admin` role card on the home route.
  - Expanded staff tabs to `Queue`, `Seated`, `Tables`, `Seat OTP`, and `Manager`.
  - Queue rows now show OTP, ETA, deposit/pre-order markers, and a PM-safe quick-seat action that prefills the seat flow.
  - `Seat OTP` now uses a 6-box entry interaction with paste support and preserved state.
  - The guest seated screen keeps the menu visible even when guest-token recovery is required and now supports an explicit `Done` exit.
- Verified the code builds after the Phase 2 changes:
  - `node --check web/app.js`
  - `npm run build`
- Completed live API validation for the new Phase 2 backend/UI data paths on the running app:
  - local app reachable on `http://localhost:3001`
  - manager OTP auth path still works
  - `GET /api/v1/menu/admin/current` returns grouped menu data for the Admin dashboard
  - `GET /api/v1/tables/events/recent` returns real venue-scoped floor events
  - `GET /api/v1/queue/live` was patched to return the richer payload the new staff UI expects (`otp`, `table`, `orders`) and now returns those fields correctly
- admin menu ops validated end to end:
  - created temporary category
  - created temporary item
  - toggled item availability
  - deleted temporary item
  - cleaned up temporary category
- Implemented core Phase 3 hardening:
  - added `.gitignore` so `.env` stays local-only and `.env.example` is the deployment template
  - added `APP_ALLOWED_ORIGINS` to the env contract and Render blueprint
  - switched production rate limiting to the shared limiter middleware with explicit `trust proxy` support
  - removed the implicit localhost Redis default; missing `REDIS_URL` now disables Redis cleanly
  - added and applied migration `20260302170000_harden_public_rls_policies`
  - verified Supabase security advisors returned no findings after the RLS hardening rollout
- Completed a local Render-like smoke boot:
  - `NODE_ENV=production`
  - `PORT=10000`
  - `APP_ALLOWED_ORIGINS=https://flock-pilot.onrender.com`
  - `REDIS_URL` omitted
  - all mock flags enabled
  - app booted cleanly
  - `/api/v1/health` returned `ok`
  - `/admin/login` returned HTTP `200`
- Added a copy-pasteable first-deploy env sheet:
  - `docs/RENDER_SMOKE_RELEASE_SHEET.md`
- Implemented the core Phase 4 reliability/security hardening locally:
  - added schema support for `QueueEntry.tableReadyDeadlineAt`, `QueueEntry.tableReadyExpiredAt`, and `Venue.invoiceSequence`
  - added `GUEST_JWT_EXPIRES_IN` to the env contract and split guest-token issuance from staff-token issuance
  - removed OTP from ordinary `GET /api/v1/queue/:entryId` responses while keeping OTP in join/session bootstrap
  - protected guest-owned reads/writes with guest auth after join bootstrap
  - made deposit and final payment initiation idempotent by reusing active pending payments
  - added auto-refund handling on queue cancellation with explicit refund outcome in the cancel response
  - moved no-show authority into DB-backed deadlines and added poller-based expiry sweeps
  - added `docs/PHASE4_DATA_REMEDIATION.sql` and ran targeted remediation for corrupted duplicate pre-orders on queue entry `1f2c4ae7-19d0-431d-adc8-7c159c3a9d95`
- Applied the Phase 4 schema migration to the connected Supabase project:
  - `phase4_reliability_security_hardening`
- Verified the TypeScript build after the Phase 4 changes:
  - `npx prisma generate`
  - `npm run build`
- Implemented the first Flock v2 feedback-response pass locally:
  - fixed `tryAdvanceQueue` so venue-specific `tableReadyWindowMin` is fetched before the reservation transaction and now drives `tableReadyDeadlineAt`
  - fixed `GET /api/v1/venues/stats/today` route shadowing by reordering `venue.routes.ts`
  - fixed `/api/v1/menu/admin/current` so it now returns `{ categories }` for the SPA contract
  - fixed table-order POS/manual kitchen sync to use the human-readable table label instead of a UUID
  - fixed `getVenueStats` to stop mutating the `now` `Date` instance
  - removed production file logging so hosted containers now use console-only logs
  - added `ONBOARDING_TOKEN` support and locked down `POST /api/v1/venues` behind `x-flock-onboarding-token`
  - upgraded `/api/v1/health` to be DB-authoritative and Redis-aware (`ok` / `degraded` / `down`)
  - moved all `@types/*` packages into `devDependencies` and refreshed `package-lock.json`
  - removed the eager Razorpay checkout script tag from `web/index.html` and switched the SPA to lazy-load Razorpay on demand
  - reduced frontend churn:
    - guest auto-refresh now stops in `SEATED`
    - staff seated bill fetches only run on the `Seated` tab and refresh at 10s cadence
  - added explicit in-flight guards and loading labels for:
    - join queue
    - restore guest session
    - pre-order payment start
    - seated table order submit
    - final payment start
  - strengthened client-side error normalization so fatal route failures no longer collapse into `[object Object]`
  - added a checked-in retention utility:
    - `scripts/prune_operational_data.ts`
  - added the next schema-hardening migration:
    - `20260303093000_v2_feedback_hardening`
    - includes:
      - `QueueEntry @@index([status, tableReadyDeadlineAt])`
      - `Notification.status` enum migration
      - `MenuItem @@unique([venueId, name])`
- Current drift after this pass:
  - the new migration is checked in locally but not yet applied to Supabase from this session
  - the current Render deployment has not been refreshed to pick up the new local code yet
