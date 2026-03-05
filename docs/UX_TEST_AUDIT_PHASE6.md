# UX Test Audit Phase 6

## Date

- 2026-03-04

## Environment tested

- Primary runtime tested: live Render deployment `https://taurant.onrender.com`
- Initial live deploy at the start of this session:
  - service: `taurant`
  - deploy: `dep-d6jrcmklsarc73cu4nf0`
  - commit lineage: `4af4271`
- After two same-day manual redeploys, the live frontend behavior was revalidated and matches the `6ddc5c1` hotfix set:
  - pre-order route now renders correctly
  - idle QR refetch churn is gone
  - narrow-mobile share-tray link layout is fixed
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
- Same-device venue resume prompt (`Continue existing entry`)
- OTP-based guest session recovery from a fresh browser context
- Share tray (`Invite others`)
- Public join route `/v/:slug/session/:joinToken`
- Second-participant join using a valid live join token
- Invalid join-token error handling
- Waiting-state `Pre-order now` path
- Direct reload of `/v/:slug/e/:entryId/preorder`
- Pre-order mobile dock behavior after adding items
- Staff login route `/staff/login`
- Staff OTP send
- Staff invalid OTP error handling
- Admin login route `/admin/login`
- Admin OTP send
- Admin invalid OTP error handling
- Mobile layout checks on Pixel and iPhone
- Console and network inspection during guest/staff/admin flows

## Findings By Severity

### Critical

#### 1. Historical: live pre-order route regression on the earlier Render build (resolved same day)

- Status:
  - Confirmed runtime issue on the earlier live Render build (`4af4271`)
  - Resolved on the current live build after the second redeploy; production behavior now matches the `6ddc5c1` hotfix set
- Reproduction:
  1. Join the queue on `/v/the-barrel-room-koramangala`
  2. From the waiting-state guest screen, trigger `Pre-order now`
  3. The URL changes to `/v/the-barrel-room-koramangala/e/<entryId>/preorder`
  4. The UI still renders the waiting-state screen instead of the pre-order interface
  5. A hard navigation directly to the `/preorder` URL reproduces the same result
- Evidence:
  - No console errors were emitted
  - Network showed the `/preorder` document loading successfully, but the page continued polling the waiting-state queue screen
  - After the second redeploy:
    - `Pre-order now` opens the actual pre-order UI
    - hard reload of `/v/:slug/e/:entryId/preorder` stays on the pre-order UI
    - adding an item updates the mobile summary dock and enables `Pay deposit`
- Likely cause (inferable):
  - A route/render regression on the live build, or a stale waiting-state refresh path is re-rendering `renderGuestEntry` after navigation and overwriting the pre-order screen
  - Relevant local code path to inspect:
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L136)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L143)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L585)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L667)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L967)
- Recommended fix:
  - Already fixed and verified live
  - Keep a regression check for both:
    - SPA navigation from the waiting-state route
    - full reload on the exact `/preorder` URL

### High

#### 1. Historical: waiting-state guest screens were repeatedly refetching the QR image in the background (resolved same day)

- Status:
  - Confirmed runtime issue on the earlier live build via network inspection
  - Resolved on the current live build after the first redeploy and still passing after the second redeploy
- Reproduction:
  1. Join the queue and stay on the waiting-state guest route with `Invite others` available
  2. Leave the page idle for 15-30 seconds
  3. Watch network activity
  4. `GET /api/v1/share/qr?...` is requested repeatedly, alongside the normal queue polling
- Evidence:
  - Multiple repeated `200` responses for `/api/v1/share/qr` were observed while the share tray was closed on the earlier build
  - On the current live build, idle waiting-state inspection no longer shows repeated `/api/v1/share/qr` fetches while the tray is closed
- Likely cause (inferable):
  - `renderGuestEntry()` calls `preloadPartyInviteQr(...)` on every waiting/notified re-render whenever `showShareAction` is true
  - The same waiting-state screen also schedules a 5-second refresh loop
  - Relevant local code path:
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L554)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L567)
    - [app.js](/Users/adsaha/Desktop/Pricing%20Engine/C/Flock/web/app.js#L667)
- Recommended fix:
  - Already fixed and verified live
  - Keep QR preload cached by invite identity and keep this decoupled from the waiting-state queue poll loop

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

#### 1. Historical: share tray link preview truncated heavily on narrow mobile widths (resolved same day)

- Status:
  - Confirmed runtime issue on the earlier live build, but non-blocking
  - Resolved on the current live build after the first redeploy
- Reproduction:
  1. Open the waiting-state guest screen on a narrow mobile viewport
  2. Open `Invite others`
  3. Inspect the link preview row above the QR
- Evidence:
  - On the earlier build, the link was technically available and copy worked, but the preview became heavily truncated on narrow widths
  - On the current live build, the link preview wraps and the `Copy` action stacks cleanly below it on iPhone width
- Likely cause (inferable):
  - The current share row prioritizes keeping the `Copy` button inline, which compresses the preview string aggressively
- Recommended fix:
  - Already fixed and verified live
  - Keep the stacked mobile layout as the default for narrow widths

## Not Testable In Current Session

- The local repo build could not be browser-tested because Prisma could not reach Supabase from this shell
- Staff/admin dashboard internals were not reachable because the live OTP send flow does not expose a usable code in-browser, and no out-of-band OTP delivery was available in this session
- Seating could not be completed because staff verification could not be completed in-session
- The seated guest tray shell (`Menu / Your Bucket / Ordered`) therefore remains blocked at runtime in this session
- Shared seated-bucket sync, participant count in seated mode, bucket clearing after send, and final-payment CTA behavior remain blocked because seating was not reached
- No live payment capture was attempted because payment mode was not re-verified as mock-safe in this session
- The `20260303093000_v2_feedback_hardening` migration remains unverified here, so schema-dependent issues beyond what the live app exposed could not be confirmed

## What Is Working Well

- Guest queue join works on the live Render deployment
- Waiting-state guest pages render cleanly on both tested mobile sizes
- The share tray works end to end:
  - visible `Invite others`
  - share sheet opens
  - QR renders correctly through `/api/v1/share/qr`
  - a second participant can join successfully through the public join link
- Same-device guest persistence works:
  - revisiting `/v/the-barrel-room-koramangala` shows `Active queue entry found for this device`
  - `Continue existing entry` links back to the active guest route
- Missing-session recovery works:
  - opening a guest route in a fresh isolated browser context shows the OTP restore gate
  - entering the valid seating OTP restores the waiting-state guest session successfully
- The production pre-order flow now works end to end for the non-payment portion:
  - `Pre-order now` opens the pre-order UI
  - direct reload of the `/preorder` URL remains stable
  - item quantities update immediately
  - the mobile summary dock updates immediately
  - `Pay deposit` enables correctly once the cart is non-empty
- Invalid join links fail with a clear inline message:
  - “This invite is invalid or expired.”
- Staff and admin OTP send flows respond successfully and show visible success banners
- Invalid staff OTP entry fails with clear inline feedback:
  - “Incorrect OTP”
- Invalid admin OTP entry fails with clear inline feedback:
  - “OTP expired or not found”
- No app-thrown console errors were observed during the tested guest, staff, admin, and join-link flows
- Expected browser-level console noise does appear on deliberately invalid auth attempts:
  - the browser logs the `400` response as a failed resource load, but the UI remains stable and shows inline error copy
- The overall mobile visual language is strong:
  - consistent dark surface treatment
  - legible contrast
  - solid card rhythm
  - headers and primary actions fit within both tested mobile widths

## Next Implementation Priorities

1. Secure a valid OTP path so the authenticated staff/admin surfaces can be exercised during the next production audit.
2. Create a practical test path for staff/admin verification in audit sessions:
   - a non-production dev hook, or
   - a controlled staging OTP path, or
   - confirmed out-of-band OTP delivery during test windows.
3. After staff access is available, run the missing runtime coverage:
   - seating
   - seated tray shell
   - shared bucket sync across two clients
   - final payment CTA behavior
   - staff/admin dashboards
4. Complete the typography cleanup so the live font system matches the intended Fraunces + DM Sans branding consistently.
5. Replace dev-local helper copy on `/staff/login` and `/admin/login` with production-safe operator copy.
6. Reconfirm payment mode before any future production audit that exercises deposit or final payment capture.

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

## Second Redeploy Verification (same day)

- A second focused production re-test was run after deploying commit `6ddc5c1`.
- Result:
  - the guest pre-order flow is now working in production
- Verified in production:
  1. Join a fresh queue entry
  2. Tap `Pre-order now` from the waiting-state guest screen
  3. The actual pre-order UI renders successfully
  4. Hard-refresh the exact `/v/:slug/e/:entryId/preorder` URL
  5. The pre-order UI still renders correctly after reload
- Additional mobile UX confirmation:
  - on the live pre-order screen, adding an item updates the mobile summary dock immediately
  - the `Pay deposit` CTA becomes enabled as expected once the cart contains items
- Current production status after the second redeploy:
  - pre-order route regression: resolved
  - QR prefetch churn while idle: resolved
  - share-tray narrow-width link layout: resolved

## Full Flow Continuation (same day)

- Additional production checks were completed after the guest hotfixes were live.
- Same-device persistence is confirmed:
  - reloading an active guest route keeps the guest on the waiting-state screen
  - reopening the venue route in the same browser context shows `Active queue entry found for this device`
  - `Continue existing entry` links back to the active guest entry
- Missing-session recovery is confirmed:
  - opening the guest route in a fresh isolated browser context shows the OTP restore screen
  - entering the valid seating OTP restores the guest session and returns the browser to the waiting-state guest route
- Narrow-width iPhone pre-order rendering remains stable on the live build:
  - the pre-order copy, category pills, item controls, summary dock, and `Pay deposit` CTA all remain visible in the tested `390 x 844` viewport
- Admin invalid-auth handling is confirmed:
  - `POST /api/v1/auth/staff/otp/verify` returns `400` for an invalid admin OTP attempt on the shared OTP rail
  - the live UI surfaces `OTP expired or not found`
- The remaining blocked coverage is now explicit:
  - authenticated staff dashboard
  - seating flow
  - seated guest tray shell
  - shared seated-bucket sync
  - final payment entry points
  - authenticated admin dashboard
