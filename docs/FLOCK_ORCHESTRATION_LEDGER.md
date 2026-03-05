# Flock Orchestration Ledger

Last updated: 2026-03-04
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

## Current Build Focus

Phase 6C is the active feature track in code: visible multi-user share/join on top of shared table sessions.

Current implementation target:

- backend already defines:
  - `PartySession`
  - `PartyParticipant`
  - `PartyBucketItem`
- queue join now creates and/or ensures one party session automatically per queue entry
- guest tokens can carry participant and party-session identity
- shared-bucket frontend cutover exists in the guest tray shell
- a visible share/join layer now exists in the guest UI:
  - `Invite others`
  - share tray
  - public join route `/v/:slug/session/:joinToken`

The current open work is no longer “backend-first only.” The remaining work is validation, deployment parity, and refinement of the user-facing multi-user flow.

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
- Multi-user foundations now exist in code:
  - party sessions
  - party participants
  - shared bucket rows
- The guest tray shell is no longer local-bucket-only:
  - the seated shell now uses backend `party-sessions` bucket state
- A visible guest invite/share flow now exists in code and should be live on production commit lineage:
  - `Invite others`
  - share tray with link copy and QR
  - public join route `/v/:slug/session/:joinToken`

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

- Stable public deployment exists:
  - `https://taurant.onrender.com`
- Render deploys remain manual (`autoDeploy: no`)
- Latest verified live Render commit is:
  - `6ddc5c1`
- Production parity caveat:
  - later local changes after `6ddc5c1` are not guaranteed live until manually redeployed

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

### 2026-03-04

- Re-baselined the live deployment status against Render.
- Verified the current live Render deploy for `https://taurant.onrender.com` is:
  - deploy `dep-d6jrcmklsarc73cu4nf0`
  - commit `4af4271` (`Add test data reset script`)
- Because `4af4271` is newer than `96f996c` (`Add shared session UX and QR proxy preload`), the currently live deployment should include:
  - the visible `Invite others` guest action
  - the public join route layer added in `web/app.js`
  - the shared-bucket frontend cutover that shipped with the party-session UX bundle
  - the app-side QR proxy route under `/api/v1/share/qr`
- Documentation drift identified and corrected:
  - previous docs still described Phase 6B as “no visible invite/share UI yet”
  - that is now stale relative to the code and the currently live Render commit lineage
- Remaining deployment uncertainty:
  - local changes made after `4af4271` are **not** guaranteed live until manually redeployed on Render
  - this includes later local-only UX refinements unless explicitly confirmed by a newer live deploy
- Remaining database uncertainty:
  - the `20260303093000_v2_feedback_hardening` migration is still not re-verified from this session
  - Supabase MCP is currently unavailable in this session (`Auth required`)
  - direct DB verification from this shell is blocked by network reachability to the Supabase pooler
- Verified database fact still held from prior work:
  - the Phase 6A `party_sessions_phase6a` schema was applied directly to the database earlier so `PartySession`, `PartyParticipant`, and `PartyBucketItem` exist for current multi-user work
- Current recommended operating assumption:
  - treat production as live on `4af4271`
  - treat the share/join layer as deployed
  - treat later local UI polish after `4af4271` as local-only until the next manual Render deploy

### 2026-03-02 (continued historical log)

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
- Implemented the first Phase 5A guest UX pass locally (not yet deployed):
  - replaced the seated guest’s stacked mobile layout with a tray-based shell:
    - `Menu`
    - `Your Bucket`
    - `Ordered`
  - added a local `BucketStore` abstraction for seated draft ordering without changing backend contracts
  - added a fixed bottom guest nav and floating pay CTA for seated guests with outstanding balance
  - added sticky category pills for guest menu browsing and wired them to category section anchors
  - moved seated local quantity changes and tray switching off full-route rerenders; they now patch the seated shell in place
  - reworked the pre-order page to support a mobile sticky summary/action dock while keeping the desktop two-column summary layout
  - kept the scope UX-only:
    - no share links
    - no QR
    - no multi-user draft sync
- Applied a follow-up UX/resilience patch locally after browser feedback:
  - fixed guest category jumps so they no longer rerender the tray immediately after scrolling
  - increased category-heading contrast and adjusted sticky category-tab positioning for mobile visibility
  - added editable controls in `Your Bucket`:
    - quantity up/down
    - explicit remove
  - changed guest session handling so transient queue-fetch failures no longer clear the guest token and force session restore
  - throttled staff stats fetches to 60s and made `/venues/stats/today` failures fail soft in the SPA instead of crashing the dashboard
  - improved mobile/staff navigation usability:
    - compact mobile header
    - horizontally scrollable staff/admin tabs on narrow screens

## Phase 6B shared-bucket cutover

- Implemented the first real multi-user frontend slice locally on top of the existing `party-sessions` backend APIs.
- The seated guest shell now hydrates party-session state when `GET /queue/:entryId` returns `entry.partySession`.
- The seated bucket is now session-backed:
  - `Menu` and `Your Bucket` edit an in-memory cart sourced from `GET /party-sessions/:id/bucket`
  - edits debounce-sync through `PUT /party-sessions/:id/bucket`
- Seated guest collaboration now uses compact scoped polling every 3 seconds for:
  - `GET /party-sessions/:id/bucket`
  - `GET /party-sessions/:id/participants`
  and does not re-poll the full guest route while seated.
- The seated shell now shows lightweight participant awareness:
  - `n guests in this table session`
- Sending an order from `Your Bucket` now clears the shared bucket after the order succeeds and preserves the existing ordered/bill flow.
- Added a developer-only local test helper:
  - `window.__flockJoinPartySession(joinToken, displayName)`
  so a second tab can join the same active party session before we build visible invite/share UI.

### 2026-03-04 (UX audit pass)

- Completed a browser-driven Phase 6 UX/runtime audit against the live Render deployment using Chrome DevTools MCP.
- Runtime used for the audit:
  - `https://taurant.onrender.com`
  - live deploy `dep-d6jrcmklsarc73cu4nf0`
  - live commit lineage `4af4271`
- Device coverage completed:
  - Pixel-sized mobile viewport
  - iPhone-sized mobile viewport
- Confirmed working on the live app:
  - guest queue join
  - waiting-state rendering
  - visible `Invite others`
  - share tray with QR via `/api/v1/share/qr`
  - second-participant join via `/v/:slug/session/:joinToken`
  - invalid join-token inline error
  - staff/admin OTP send
  - staff invalid-OTP error handling
- Confirmed live runtime issue:
  - `Pre-order now` currently routes to `/v/:slug/e/:entryId/preorder` but still renders the waiting-state screen on the current live build
  - this is the primary UX blocker found in the live guest flow
- Confirmed live performance issue:
  - waiting-state guest pages repeatedly refetch the QR proxy endpoint while idle because the QR preload runs on repeated guest rerenders
- Additional likely design consistency issue from code inspection:
  - the branding migration is still incomplete because `web/styles.css` retains `Instrument Serif` references while `web/index.html` imports only `Fraunces` and `DM Sans`
- Test blockers recorded:
  - local repo runtime could not be started for browser testing because Prisma could not reach the Supabase pooler from this shell
  - staff/admin verification could not be completed in-session because no real OTP was available through the live UI
  - seated tray shell and shared seated-bucket sync remain unverified at runtime until staff seating can be exercised
- Wrote the structured audit to:
  - `docs/UX_TEST_AUDIT_PHASE6.md`

### 2026-03-04 (Phase 6 UX hotfix patch, local only)

- Applied a minimal frontend hotfix in the local repo to address the highest-confidence issues found in the UX audit:
  - `web/app.js`
    - `navigate(path)` now clears pending refresh timers before route transitions
    - `/v/:slug/e/:entryId/preorder` route matching is now explicit (`segments.length === 5`) and is checked before the base guest entry route
    - QR preload is now cached by invite URL so waiting/notified guest rerenders do not repeatedly refetch `/api/v1/share/qr`
  - `web/styles.css`
    - the share tray now stacks the link row on narrow widths and allows the invite-link preview to wrap instead of hard truncating
- Validation completed after the patch:
  - `node --check web/app.js`
  - `npm run build`
- Current deployment state after this patch:
  - the fix is local only
  - Render has not been manually redeployed yet
  - the live app still needs a post-deploy browser re-test to confirm the pre-order regression is actually resolved in production

### 2026-03-04 (post-deploy verification + second local fix)

- Ran a focused production verification pass after the first manual Render deploy of the UX hotfix commit.
- Verified live on `https://taurant.onrender.com`:
  - the QR preload churn fix is working
    - waiting-state guest pages no longer repeatedly refetch `/api/v1/share/qr` while idle
  - the narrow-mobile share tray layout fix is working
    - the invite-link preview now wraps
    - the `Copy` button stacks cleanly below the link preview on iPhone-width screens
- The guest pre-order flow is still broken in production after that deploy.
- Root cause identified during the re-test:
  - `closeShareSheet()` was still force-calling `renderGuestEntry(...)`
  - `renderRoute()` invokes `closeShareSheet({ keepState: false })` at the start of every route render
  - this means `/v/:slug/e/:entryId/preorder` gets immediately overwritten back into the guest waiting-state screen
- Applied a second local-only frontend fix:
  - removed the forced `renderGuestEntry(...)` side effect from `closeShareSheet()`
- Validation completed after the second fix:
  - `node --check web/app.js`
  - `npm run build`
- Current state now:
  - QR/network fix: confirmed live
  - share-tray narrow-width layout fix: confirmed live
  - pre-order fix: still needs one more push + manual Render deploy before production can be re-tested

### 2026-03-04 (second redeploy verification)

- Ran the tight production verification again after the second manual Render deploy (commit `6ddc5c1`).
- Confirmed live on `https://taurant.onrender.com`:
  - `Pre-order now` from the waiting-state guest route now opens the actual pre-order UI
  - hard-reloading the exact `/v/:slug/e/:entryId/preorder` URL keeps the app on the pre-order UI
  - adding an item on the pre-order page updates the mobile deposit dock immediately
  - the `Pay deposit` CTA enables correctly when the cart is non-empty
- This clears the previously blocking guest pre-order regression found during the Phase 6 UX audit.
- Current production result after the two redeploys:
  - pre-order route regression: fixed
  - QR preload churn on waiting state: fixed
  - narrow-mobile share-tray link layout: fixed
- Remaining larger runtime coverage still pending:
  - authenticated staff dashboard pass
  - authenticated admin dashboard pass
  - seated tray shell / shared bucket / final payment end-to-end

### 2026-03-04 (full production flow continuation)

- Continued the live Phase 6 production test pass after the guest hotfixes were verified.
- Confirmed the current production behavior now matches the `6ddc5c1` hotfix set in-browser:
  - pre-order route regression is gone
  - idle QR refetch churn is gone
  - narrow-mobile share-tray layout is fixed
- Completed guest persistence and recovery checks in production:
  - reloading an active guest route preserves the waiting-state view
  - revisiting the venue route in the same browser context shows `Active queue entry found for this device`
  - `Continue existing entry` returns to the active queue entry
  - opening the same guest route in a fresh isolated context shows the OTP recovery gate
  - entering the valid seating OTP restores the guest session successfully
- Completed another narrow-width mobile check on the live pre-order page:
  - iPhone-width `390 x 844` rendering keeps the hero copy, category pills, quantity controls, mobile deposit dock, and `Pay deposit` CTA visible
- Completed explicit invalid-admin-auth handling verification:
  - invalid OTP returns a `400` on the shared OTP verify endpoint
  - the UI surfaces `OTP expired or not found`
- Remaining blocked production coverage is now explicit:
  - authenticated staff dashboard flows
  - seating flow
  - seated tray shell
  - shared seated-bucket sync
  - final payment entry points
  - authenticated admin dashboard flows
- Reason those areas remain blocked:
  - no valid OTP was available in-session for staff/admin verification
  - payment mode was not re-verified as safe for live capture, so no payment capture was attempted

### 2026-03-04 (mock OTP restore path, local only)

- Added an explicit test-only OTP exposure path in the local repo so authenticated production-pass testing can be unblocked without relying on direct DB access.
- New env flag:
  - `EXPOSE_MOCK_OTP_IN_API=false` by default
- Behavior:
  - when both `USE_MOCK_NOTIFICATIONS=true` and `EXPOSE_MOCK_OTP_IN_API=true`, the auth send endpoints now include `mockOtp` in the JSON response:
    - `POST /api/v1/auth/guest/otp/send`
    - `POST /api/v1/auth/staff/otp/send`
  - otherwise, the response remains unchanged and only returns `message: "OTP sent"`
- Safety posture:
  - the new path is explicit opt-in and remains off by default
  - no OTP is exposed unless that flag is intentionally enabled
- Files updated:
  - `src/config/env.ts`
  - `src/services/auth.service.ts`
  - `src/controllers/auth.controller.ts`
  - `.env.example`
- Validation completed:
  - `node --check src/controllers/auth.controller.ts`
  - `npm run build`
- Current deployment state:
  - this is local only
  - Render must be manually redeployed, and the new env var must be set explicitly, before the live app exposes mock OTPs for testing

### 2026-03-04 (guarded internal verification route, local only)

- Added a read-only internal verification route to avoid blocking on Supabase MCP or direct DB connectivity from this shell.
- New route:
  - `GET /api/v1/internal/test-state`
- Guardrails:
  - requires `x-flock-onboarding-token`
  - returns `404` unless `EXPOSE_MOCK_OTP_IN_API=true`
- Query parameters:
  - `phone` (required)
  - `purpose` (`STAFF_LOGIN` default, or `GUEST_QUEUE`)
  - `migration` (optional migration name to check)
- Response includes:
  - latest unverified OTP row for the requested phone/purpose
  - last 10 `_prisma_migrations` rows
  - optional applied/matched status for the requested migration name
- Safety posture:
  - read-only
  - explicit opt-in
  - gated by the existing onboarding secret
- File updated:
  - `src/routes/index.ts`
- Validation completed:
  - `npm run build`
- Current deployment state:
  - this route is local only until the next push + manual Render deploy
  - it will remain inactive on Render unless `EXPOSE_MOCK_OTP_IN_API=true` is set
