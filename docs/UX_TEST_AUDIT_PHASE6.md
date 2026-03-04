# UX Test Audit Phase 6

## Date

- 2026-03-04

## Environment tested

- Primary runtime tested: live Render deployment `https://taurant.onrender.com`
- Verified live deploy at start of session:
  - service: `taurant`
  - deploy: `dep-d6jrcmklsarc73cu4nf0`
  - commit lineage: `4af4271`
- Local runtime attempt:
  - `PORT=3001 npm run dev`
  - blocked in this shell by Prisma `P1001` because the Supabase pooler host was unreachable

## Whether DevTools MCP was available

- Yes
- Chrome DevTools MCP was available and used for navigation, viewport emulation, snapshots, screenshots, console inspection, and network inspection

## Devices tested

- Pixel-sized mobile viewport:
  - `412 x 915`
  - Android / Chrome mobile UA
- iPhone-sized mobile viewport:
  - `390 x 844`
  - iPhone / Safari mobile UA

## Flows tested

- Guest landing route `/`
- Guest venue landing `/v/the-barrel-room-koramangala`
- Guest queue join
- Waiting-state guest route `/v/:slug/e/:entryId`
- Share tray (`Invite others`)
- Public join route `/v/:slug/session/:joinToken`
- Second-participant join using a valid live join token
- Invalid join-token error handling
- Waiting-state `Pre-order now` path
- Staff login route `/staff/login`
- Staff OTP send
- Staff invalid OTP error handling
- Admin login route `/admin/login`
- Admin OTP send
- Mobile layout checks on Pixel and iPhone
- Console and network inspection during guest/staff/admin flows

## Findings By Severity

### Critical

#### 1. Live pre-order route is broken on the current Render build

- Status:
  - Confirmed runtime issue on live Render (`4af4271`)
- Reproduction:
  1. Join the queue on `/v/the-barrel-room-koramangala`
  2. From the waiting-state guest screen, trigger `Pre-order now`
  3. The URL changes to `/v/the-barrel-room-koramangala/e/<entryId>/preorder`
  4. The UI still renders the waiting-state screen instead of the pre-order interface
  5. A hard navigation directly to the `/preorder` URL reproduces the same result
- Evidence:
  - No console errors were emitted
  - Network showed the `/preorder` document loading successfully, but the page continued polling the waiting-state queue screen
- Likely cause (inferable):
  - A route/render regression on the live build, or a stale waiting-state refresh path is re-rendering `renderGuestEntry` after navigation and overwriting the pre-order screen
  - Relevant local code path to inspect:
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L136)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L143)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L585)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L667)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L967)
- Recommended fix:
  - Fix this before pilot use; pre-order is part of the core guest flow
  - Ensure route transitions clear all pending waiting-state timers before `history.pushState`
  - Add an explicit regression check that `/v/:slug/e/:entryId/preorder` renders the pre-order shell after both SPA navigation and full reload
  - Redeploy the latest local frontend only after this is revalidated against Render

### High

#### 1. Waiting-state guest screens are repeatedly refetching the QR image in the background

- Status:
  - Confirmed runtime issue on live Render via network inspection
- Reproduction:
  1. Join the queue and stay on the waiting-state guest route with `Invite others` available
  2. Leave the page idle for 15-30 seconds
  3. Watch network activity
  4. `GET /api/v1/share/qr?...` is requested repeatedly, alongside the normal queue polling
- Evidence:
  - Multiple repeated `200` responses for `/api/v1/share/qr` were observed while the share tray was closed
- Likely cause (inferable):
  - `renderGuestEntry()` calls `preloadPartyInviteQr(...)` on every waiting/notified re-render whenever `showShareAction` is true
  - The same waiting-state screen also schedules a 5-second refresh loop
  - Relevant local code path:
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L554)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L567)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L667)
- Recommended fix:
  - Cache the QR preload by `joinToken` and skip re-requesting it if the token has not changed
  - Only preload once per route session, or only when opening the share tray
  - Keep the queue poll, but decouple it from QR image fetches

### Medium

#### 1. Typography system is still internally inconsistent after the branding migration

- Status:
  - Likely issue from code inspection; partially visible as mixed serif treatment in the UI
- Reproduction:
  1. Inspect the current font imports
  2. Inspect remaining serif declarations in CSS
  3. Compare the intended Fraunces + DM Sans system with the still-present `Instrument Serif` selectors
- Evidence:
  - [index.html](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/index.html#L9) imports only `DM Sans` and `Fraunces`
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L297) still uses `Instrument Serif` for card titles
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L315) still uses `Instrument Serif` for section titles
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L744) still uses `Instrument Serif` for the seated shell title
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L1045) still uses `Instrument Serif` for the mobile order dock total
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L1253) still uses `Instrument Serif` for queue row numerals
  - [styles.css](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/styles.css#L1391) still uses `Instrument Serif` for table numerals
- Likely cause (inferable):
  - The branding migration to Fraunces + DM Sans was only partially completed
- Recommended fix:
  - Replace the remaining `Instrument Serif` declarations with the intended Fraunces usage, or re-import Instrument Serif intentionally if it is still part of the design system
  - Do one typography cleanup pass so live visuals match the documented brand direction consistently

#### 2. Public staff/admin login copy still reads like a dev-only environment

- Status:
  - Confirmed runtime issue (UX/copy quality)
- Reproduction:
  1. Open `/staff/login`
  2. Open `/admin/login`
  3. Read the helper copy under the OTP forms
- Evidence:
  - Staff login says “Use one of the seeded pilot staff phone numbers for local testing.”
  - Staff login also says “Local dev with mock notifications still uses the same verification flow.”
  - This appears on the live public Render deployment
- Likely cause (inferable):
  - Local-development helper copy was left in the production-facing SPA
  - Relevant local code path:
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L1139)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L1151)
- Recommended fix:
  - Remove dev-local wording from the public build
  - Replace it with venue-operator-safe copy that does not mention seeded numbers or mock notifications

### Low

#### 1. Share tray link preview truncates heavily on narrow mobile widths

- Status:
  - Confirmed runtime issue, but non-blocking
- Reproduction:
  1. Open the waiting-state guest screen on a narrow mobile viewport
  2. Open `Invite others`
  3. Inspect the link preview row above the QR
- Evidence:
  - The link is technically available and copy works, but the preview becomes heavily truncated on narrow widths
- Likely cause (inferable):
  - The current share row prioritizes keeping the `Copy` button inline, which compresses the preview string aggressively
- Recommended fix:
  - Consider a two-line wrapped preview, stacked layout on small widths, or a shorter display label such as “Session link”

## Not Testable In Current Session

- The local repo build could not be browser-tested because Prisma could not reach Supabase from this shell
- Staff/admin dashboard internals were not reachable because the live OTP send flow does not expose the code in-browser, and no out-of-band OTP delivery was available in this session
- The seated guest tray shell (`Menu / Your Bucket / Ordered`) could not be validated at runtime because seating requires staff authentication
- Shared seated-bucket sync, participant count in seated mode, bucket clearing after send, and final-payment CTA behavior were therefore not runtime-validated in this session
- The `20260303093000_v2_feedback_hardening` migration remains unverified here, so schema-dependent issues beyond what the live app exposed could not be confirmed

## What Is Working Well

- Guest queue join works on the live Render deployment
- Waiting-state guest pages render cleanly on both tested mobile sizes
- The share tray works end to end:
  - visible `Invite others`
  - share sheet opens
  - QR renders correctly through `/api/v1/share/qr`
  - a second participant can join successfully through the public join link
- Invalid join links fail with a clear inline message:
  - “This invite is invalid or expired.”
- Staff and admin OTP send flows respond successfully and show visible success banners
- Invalid staff OTP entry fails with clear inline feedback:
  - “Incorrect OTP”
- No console errors were observed during the tested guest, staff, admin, and join-link flows
- The overall mobile visual language is strong:
  - consistent dark surface treatment
  - legible contrast
  - solid card rhythm
  - headers and primary actions fit within both tested mobile widths

## Next Implementation Priorities

1. Fix the live pre-order route regression and re-test both SPA navigation and direct URL entry on Render.
2. Stop unnecessary QR prefetch churn on waiting/notified guest pages.
3. Redeploy the latest local frontend after fixing the pre-order regression, then rerun the same mobile pass.
4. Complete the typography cleanup so the live font system matches the intended Fraunces + DM Sans branding consistently.
5. Create a practical test path for staff/admin verification in audit sessions:
   - a non-production dev hook, or
   - a controlled staging OTP path, or
   - confirmed out-of-band OTP delivery during test windows.
6. After staff access is available, run the missing runtime coverage:
   - seating
   - seated tray shell
   - shared bucket sync across two clients
   - final payment CTA behavior
   - staff/admin dashboards

## Follow-up Local Fix Applied After This Audit

- A local repo patch was applied immediately after this audit (not yet deployed to Render):
  - `web/app.js`
    - clears pending guest refresh timers before SPA navigation
    - makes `/v/:slug/e/:entryId/preorder` route matching explicit (`segments.length === 5`) and checks it before the base guest entry route
    - caches QR preloads by invite URL so waiting-state rerenders do not keep forcing new QR image fetches
  - `web/styles.css`
    - stacks the share-tray link row on narrow mobile widths
    - allows the invite-link preview to wrap instead of hard truncating
- Validation completed after the patch:
  - `node --check web/app.js`
  - `npm run build`
- Remaining state:
  - this fix is local-only until the next manual Render deploy
  - the live app at `https://taurant.onrender.com` still needs to be re-tested after deployment to confirm the runtime regression is actually resolved

## Post-Deploy Re-Test (same day)

- A focused production re-test was run again after the first manual Render deploy of the hotfix commit.
- Confirmed live improvements:
  - the QR prefetch churn issue is resolved on the live app
    - waiting-state queue polling continues
    - repeated idle `/api/v1/share/qr` requests were no longer observed
  - the narrow-mobile share tray layout fix is live
    - the invite link preview now wraps
    - the `Copy` button stacks below the preview on iPhone-width screens
- Remaining live blocker:
  - the pre-order route is still broken in production even after the first hotfix deploy
- Root cause identified:
  - `closeShareSheet()` still force-calls `renderGuestEntry(...)` on any guest route when the share sheet closes/reset logic runs
  - because `renderRoute()` starts by calling `closeShareSheet({ keepState: false })`, loading `/v/:slug/e/:entryId/preorder` gets overwritten back into the guest waiting screen
- Additional local-only follow-up fix applied after this re-test:
  - removed the forced `renderGuestEntry(...)` side effect from `closeShareSheet()`
  - validation passed:
    - `node --check web/app.js`
    - `npm run build`
- Current state after this second fix:
  - the follow-up fix is local only
  - it still needs to be pushed and manually redeployed before production can be re-tested again
