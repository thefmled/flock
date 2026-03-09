import {
  ADMIN_PENDING_PHONE_KEY,
  API_BASE,
  createDefaultPartyPollState,
  DEFAULT_VENUE_SLUG,
  EMPTY_VENUE_STATS,
  STAFF_AUTH_KEY,
  STAFF_PENDING_PHONE_KEY,
} from './modules/constants.js';
import {
  buildCartSummary,
  bucketItemsToCart,
  cartToBucketItems,
  menuItemTotal,
  normaliseDraftCart,
  serialiseDraftCart,
} from './modules/cart.js';
import {
  describeClientError,
  extractErrorText,
  isAuthErrorMessage,
  isTransientServiceErrorMessage,
  normaliseApiError,
  renderDependencyWarnings,
} from './modules/errors.js';
import {
  escapeHtml,
  formatMoney,
  formatRelativeStamp,
  renderStatusBadge,
} from './modules/format.js';
import {
  computePartyPollBackoff,
  computeScheduledPartyPollDelay,
} from './modules/polling.js';
import { runHostedPayment } from './modules/payments.js';
import {
  buildStaffDashboardFetchPlan,
  resolveStaffDashboardRefreshMs,
} from './modules/staff-dashboard.js';
import {
  clearGuestEntryId,
  clearGuestSession,
  clearStaffAuth,
  consumeFlash,
  getCart,
  getGuestEntryId,
  getGuestSession,
  getStaffAuth,
  getTableCart,
  normalisePhone,
  setCart,
  setFlash,
  setGuestEntryId,
  setGuestSession,
  setTableCart,
  updateCart,
  updateTableCart,
} from './modules/storage.js';

const appRoot = document.getElementById('app');
const uiState = {
  timerId: null,
  partyPollerId: null,
  nextRenderResetScroll: false,
  guestJoinSubmitting: false,
  preorderSubmitting: false,
  tableOrderSubmitting: false,
  paymentSubmitting: false,
  guestSessionRestoring: false,
  guestTray: 'menu',
  guestTrayUserChosen: false,
  guestMenuActiveCategory: null,
  activeGuestView: null,
  activePartySessionId: null,
  partySessionMeta: null,
  partyParticipants: [],
  shareContext: null,
  shareSheetOpen: false,
  shareQrLoading: false,
  shareQrKey: '',
  shareQrSrc: '',
  shareLink: '',
  sessionJoinSubmitting: false,
  sessionJoinError: '',
  partyPoll: createDefaultPartyPollState(),
  partyBucket: {
    cart: {},
    serverItems: [],
    lastSyncedAt: 0,
    lastSyncError: '',
    isLoading: false,
    isSyncing: false,
    pendingSyncTimer: null,
    dirty: false,
  },
  staffTab: 'queue',
  staffSeat: {
    otpDigits: ['', '', '', '', '', ''],
    tableId: '',
    prefilledFromQueueId: null,
    suggestedTableId: null,
    error: '',
    success: '',
    isSubmitting: false,
  },
  staffSeatedBills: {},
  staffLastUpdatedAt: 0,
  staffStats: null,
  staffStatsFetchedAt: 0,
  staffTables: [],
  staffTablesFetchedAt: 0,
  staffRecentTableEvents: [],
  staffRecentTableEventsFetchedAt: 0,
  staffHistory: [],
  staffHistoryLoadedAt: 0,
  adminTab: 'menu',
  adminMenu: {
    categories: [],
    isLoading: false,
    error: '',
  },
};

document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-nav]');
  if (!link) return;
  event.preventDefault();
  navigate(link.getAttribute('href') || '/');
});

window.addEventListener('popstate', () => {
  uiState.nextRenderResetScroll = true;
  renderRoute().catch(handleFatalError);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && uiState.activePartySessionId && !uiState.partyPollerId) {
    startPartySessionPolling();
  }
});

renderRoute().catch(handleFatalError);

function clearTimer() {
  if (uiState.timerId) {
    window.clearTimeout(uiState.timerId);
    uiState.timerId = null;
  }
}

function clearPartySessionPolling() {
  if (uiState.partyPollerId) {
    window.clearTimeout(uiState.partyPollerId);
    uiState.partyPollerId = null;
  }
}

function clearPartyBucketSyncTimer() {
  if (uiState.partyBucket.pendingSyncTimer) {
    window.clearTimeout(uiState.partyBucket.pendingSyncTimer);
    uiState.partyBucket.pendingSyncTimer = null;
  }
}

function resetPartyBucketState() {
  clearPartyBucketSyncTimer();
  uiState.partyBucket = {
    cart: {},
    serverItems: [],
    lastSyncedAt: 0,
    lastSyncError: '',
    isLoading: false,
    isSyncing: false,
    pendingSyncTimer: null,
    dirty: false,
  };
}

function resetActiveGuestShellState() {
  clearPartySessionPolling();
  uiState.activeGuestView = null;
  uiState.activePartySessionId = null;
  uiState.partySessionMeta = null;
  uiState.partyParticipants = [];
  resetPartyBucketState();
}

function scheduleRefresh(fn, delayMs) {
  clearTimer();
  uiState.timerId = window.setTimeout(() => {
    fn().catch(handleBackgroundRefreshError);
  }, delayMs);
}

function navigate(path) {
  clearTimer();
  if (window.location.pathname === path) {
    renderRoute().catch(handleFatalError);
    return;
  }
  uiState.nextRenderResetScroll = true;
  history.pushState({}, '', path);
  renderRoute().catch(handleFatalError);
}

function getCurrentGuestRouteContext() {
  const segments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments[0] === 'v' && segments[2] === 'e' && segments[1] && segments[3]) {
    return {
      slug: segments[1],
      entryId: segments[3],
    };
  }
  return null;
}

function renderPage(html, title = 'Flock') {
  clearTimer();
  clearPartySessionPolling();
  document.title = title;
  const previousScrollY = window.scrollY;
  const shouldResetScroll = uiState.nextRenderResetScroll;
  uiState.nextRenderResetScroll = false;
  appRoot.innerHTML = html;
  window.scrollTo({
    top: shouldResetScroll ? 0 : previousScrollY,
    behavior: 'auto',
  });
}

const _actionGuards = new Set();
function guardedAction(key, fn) {
  return async function (...args) {
    if (_actionGuards.has(key)) return;
    _actionGuards.add(key);
    try { await fn.apply(this, args); } finally { _actionGuards.delete(key); }
  };
}

function handleFatalError(error) {
  const message = describeClientError(error);
  renderPage(renderShell({
    pill: 'System',
    body: `
      <div class="section-head">
        <div class="section-title">Something went wrong</div>
        <div class="section-sub">${escapeHtml(message)}</div>
      </div>
      <div class="card">
        <div class="card-sub">The frontend hit an unrecoverable error while loading this route.</div>
        <div class="row">
          <a class="btn btn-primary" data-nav href="/">Return home</a>
          <button class="btn btn-secondary" id="retry-page">Retry</button>
        </div>
      </div>
    `,
  }));

  document.getElementById('retry-page')?.addEventListener('click', () => {
    renderRoute().catch(handleFatalError);
  });
}

function handleBackgroundRefreshError(error) {
  const message = describeClientError(error);
  console.warn('Background refresh failed:', message);

  const staleBanners = document.querySelectorAll('[data-transient-error="true"]');
  staleBanners.forEach((node) => node.remove());

  const shell = appRoot.querySelector('.app-shell');
  if (shell) {
    const banner = document.createElement('div');
    banner.className = 'alert alert-red';
    banner.dataset.transientError = 'true';
    banner.style.marginBottom = '18px';
    banner.innerHTML = `<div>${escapeHtml(message)} Retrying automatically.</div>`;
    shell.prepend(banner);
  }

  scheduleRefresh(() => renderRoute(), 5000);
}

async function renderRoute() {
  closeShareSheet({ keepState: false });
  resetActiveGuestShellState();
  const segments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (segments.length === 0) {
    renderHome();
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments.length === 2) {
    await renderVenueLanding(segments[1]);
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments[2] === 'session' && segments[3] && segments.length === 4) {
    await renderGuestSessionJoin(segments[1], decodeURIComponent(segments[3]));
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments[2] === 'e' && segments[3] && segments[4] === 'preorder' && segments.length === 5) {
    await renderPreorder(segments[1], segments[3]);
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments[2] === 'e' && segments[3] && segments.length === 4) {
    await renderGuestEntry(segments[1], segments[3]);
    return;
  }

  if (segments[0] === 'staff' && segments[1] === 'login') {
    await renderStaffLogin();
    return;
  }

  if (segments[0] === 'staff' && segments[1] === 'dashboard') {
    await renderStaffDashboard();
    return;
  }

  if (segments[0] === 'admin' && segments[1] === 'login') {
    await renderAdminLogin();
    return;
  }

  if (segments[0] === 'admin' && segments[1] === 'dashboard') {
    await renderAdminDashboard();
    return;
  }

  renderPage(renderShell({
    pill: 'Flock',
    body: `
      <div class="section-head">
        <div class="section-title">Route not found</div>
        <div class="section-sub">This path is not part of the closed pilot build.</div>
      </div>
      <a class="btn btn-primary" data-nav href="/">Go to landing</a>
    `,
  }), 'Flock | Missing');
}

function renderHome() {
  renderPage(`
    <main id="landing">
      <div class="brand">
        <div class="brand-name">fl<em>o</em>ck</div>
        <div class="brand-tag">Queue · Pre-order · Pay</div>
      </div>
      <div class="role-cards">
        <a class="role-card" data-nav href="/v/${DEFAULT_VENUE_SLUG}">
          <span class="role-card-icon">Queue</span>
          <div class="role-card-title">Guest Flow</div>
          <div class="role-card-desc">Join the queue, pre-order, track the table-ready state, and complete the final payment.</div>
          <div class="role-card-cta">+</div>
        </a>
        <a class="role-card" data-nav href="/staff/login">
          <span class="role-card-icon">Floor</span>
          <div class="role-card-title">Staff Console</div>
          <div class="role-card-desc">Run live queue ops, free tables, verify OTPs, and manage the pilot venue in real time.</div>
          <div class="role-card-cta">+</div>
        </a>
        <a class="role-card" data-nav href="/admin/login">
          <span class="role-card-icon">Admin</span>
          <div class="role-card-title">Admin Console</div>
          <div class="role-card-desc">Run menu operations, enable or disable items, and manage category growth in the same visual system.</div>
          <div class="role-card-cta">+</div>
        </a>
      </div>
    </main>
  `, 'Flock');
}

async function renderVenueLanding(slug) {
  const venue = await apiRequest(`/venues/${slug}`);
  const activeEntryId = getGuestEntryId(slug);
  const flash = consumeFlash();

  renderPage(`
    <main id="landing">
      <div class="brand">
        <div class="brand-name">fl<em>o</em>ck</div>
        <div class="brand-tag">Queue · Pre-order · Pay</div>
      </div>
      <div class="role-cards">
        <div class="role-card" style="cursor:default">
          <span class="role-card-icon">Venue</span>
          <div class="role-card-title">${escapeHtml(venue.name)}</div>
          <div class="role-card-desc">${escapeHtml(venue.address)}, ${escapeHtml(venue.city)}. Deposit default: ${venue.depositPercent}%.</div>
          <div class="role-card-cta">${venue.isQueueOpen ? 'Open' : 'Closed'}</div>
        </div>
        <div class="role-card" style="cursor:default; max-width:360px; min-width:300px;">
          <div class="role-card-title">Join the queue</div>
          <div class="role-card-desc" style="margin-bottom:16px;">No app download. Use your phone number as your queue identity and receive a seating OTP instantly.</div>
          ${flash ? renderInlineFlash(flash) : ''}
          ${activeEntryId ? `
            <div class="alert alert-blue">
              <div>Active queue entry found for this device.</div>
            </div>
            <a class="btn btn-secondary btn-full" data-nav href="/v/${slug}/e/${activeEntryId}" style="margin-bottom:14px;">Continue existing entry</a>
          ` : ''}
          <form id="join-form">
            <div class="form-group">
              <label class="form-label" for="guest-name">Guest name</label>
              <input class="form-input" id="guest-name" required maxlength="80" placeholder="Asha">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="guest-phone">Phone</label>
                <input class="form-input" id="guest-phone" required placeholder="9876543210" inputmode="numeric">
              </div>
              <div class="form-group">
                <label class="form-label" for="party-size">Party size</label>
                <input class="form-input" id="party-size" required type="number" min="1" max="20" value="2">
              </div>
            </div>
            <button class="btn btn-primary btn-full" type="submit" ${venue.isQueueOpen ? '' : 'disabled'}>
              ${venue.isQueueOpen ? 'Join queue' : 'Queue closed'}
            </button>
          </form>
        </div>
      </div>
    </main>
  `, `Flock | ${venue.name}`);

  document.getElementById('join-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (uiState.guestJoinSubmitting) return;

    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    uiState.guestJoinSubmitting = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Joining...';
    }

    const name = document.getElementById('guest-name').value.trim();
    const phone = normalisePhone(document.getElementById('guest-phone').value);
    const partySize = Number(document.getElementById('party-size').value);

    try {
      const entry = await apiRequest('/queue', {
        method: 'POST',
        body: {
          venueId: venue.id,
          guestName: name,
          guestPhone: phone,
          partySize,
        },
      });
      setGuestEntryId(slug, entry.id);
      setGuestSession({
        entryId: entry.id,
        venueSlug: slug,
        venueId: venue.id,
        guestToken: entry.guestToken,
        otp: entry.otp,
      });
      setFlash('green', `Joined queue. OTP ${entry.otp} issued with position #${entry.position}.`);
      navigate(`/v/${slug}/e/${entry.id}`);
    } catch (error) {
      setFlash('red', error.message);
      await renderVenueLanding(slug);
    } finally {
      uiState.guestJoinSubmitting = false;
    }
  });
}

async function renderGuestEntry(slug, entryId) {
  const guestSession = getGuestSession(entryId);
  const venue = await apiRequest(`/venues/${slug}`);

  if (!guestSession?.guestToken) {
    const flash = consumeFlash();
    renderPage(renderShell({
      pill: 'Guest',
      body: `
        ${flash ? renderInlineFlash(flash) : ''}
        <div class="card">
          <div class="card-title">Restore your guest session</div>
          <div class="card-sub">This device no longer has the active guest session token. Enter the seating OTP once to recover the queue entry securely.</div>
          <form id="recover-guest-session-form">
            <div class="form-group">
              <label class="form-label" for="guest-session-otp">Seating OTP</label>
              <input class="form-input" id="guest-session-otp" required maxlength="6" placeholder="123456">
            </div>
            <button class="btn btn-secondary btn-full" type="submit">Restore ordering</button>
          </form>
          <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px;">
            <div class="card-sub" style="margin-bottom:10px;">Testing or wrong device? Clear this session and start fresh.</div>
            <button class="btn btn-ghost btn-full" id="clear-guest-session-btn" type="button">Leave queue &amp; start fresh</button>
          </div>
        </div>
      `,
      right: `<a class="btn btn-secondary btn-sm" data-nav href="/v/${slug}">Venue</a>`,
    }), `Flock | ${venue.name}`);

    document.getElementById('recover-guest-session-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (uiState.guestSessionRestoring) return;

      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      uiState.guestSessionRestoring = true;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Restoring...';
      }

      const otp = document.getElementById('guest-session-otp').value.trim();

      try {
        const session = await apiRequest(`/queue/${entryId}/session`, {
          method: 'POST',
          body: { otp },
        });
        setGuestSession({
          entryId,
          venueSlug: slug,
          venueId: venue.id,
          guestToken: session.guestToken,
          otp,
        });
        setFlash('green', 'Guest ordering session restored.');
        await renderGuestEntry(slug, entryId);
      } catch (error) {
        setFlash('red', error.message);
        await renderGuestEntry(slug, entryId);
      } finally {
        uiState.guestSessionRestoring = false;
      }
    });

    document.getElementById('clear-guest-session-btn')?.addEventListener('click', () => {
      clearGuestSession(entryId);
      clearGuestEntryId(slug);
      setTableCart(entryId, {});
      navigate(`/v/${slug}`);
    });

    return;
  }

  let entry;
  try {
    entry = await apiRequest(`/queue/${entryId}`, {
      auth: 'guest',
      guestToken: guestSession.guestToken,
    });
  } catch (error) {
    if (/Unauthorized|expired|invalid/i.test(error.message)) {
      clearGuestSession(entryId);
      setFlash('amber', 'Your guest session expired on this device. Restore it with the seating OTP.');
      await renderGuestEntry(slug, entryId);
      return;
    }

    renderPage(renderShell({
      pill: 'Guest',
      body: `
        <div class="section-head">
          <div class="section-title">Guest session unavailable</div>
          <div class="section-sub">${escapeHtml(error.message || 'We could not refresh this table session right now.')}</div>
        </div>
        <div class="card">
          <div class="card-sub">Your guest token is still kept on this device. This looks like a temporary server issue, not a lost session.</div>
          <div class="row">
            <button class="btn btn-primary" id="retry-guest-route" type="button">Retry</button>
            <a class="btn btn-secondary" data-nav href="/v/${slug}">Venue</a>
          </div>
        </div>
      `,
      right: `<a class="btn btn-secondary btn-sm" data-nav href="/">Exit</a>`,
    }), `Flock | ${venue.name}`);

    document.getElementById('retry-guest-route')?.addEventListener('click', () => {
      renderGuestEntry(slug, entryId).catch(handleFatalError);
    });
    return;
  }

  setGuestEntryId(slug, entryId);
  if (entry.status === 'SEATED') {
    await loadPartySessionState(entry, guestSession);
  } else {
    uiState.activePartySessionId = null;
    uiState.partySessionMeta = null;
    uiState.partyParticipants = [];
    resetPartyBucketState();
  }
  const flash = consumeFlash();
  const tableCart = getTableCart(entryId);
  const tableCartSummary = buildCartSummary(venue.menuCategories || [], tableCart);
  const bill = entry.status === 'SEATED' || entry.status === 'COMPLETED'
    ? await apiRequest(`/orders/bill/${entryId}`, {
      auth: 'guest',
      guestToken: guestSession.guestToken,
    }).catch(() => null)
    : null;

  const hasDeposit = entry.depositPaid > 0;
  const activeStep = entry.status === 'COMPLETED'
    ? 5
    : entry.status === 'SEATED'
      ? 4
      : hasDeposit
        ? 2
        : 1;

  const body = entry.status === 'SEATED'
    ? `
      ${renderStepBar(activeStep)}
      ${flash ? renderInlineFlash(flash) : ''}
      ${renderSeatedGuestShell({ entry, venue, bill, guestSession })}
    `
    : `
      ${entry.status === 'NOTIFIED' ? `<div class="banner">Table ready${entry.table?.label ? ` · ${escapeHtml(entry.table.label)}` : ''} · Show your OTP to staff now</div>` : ''}
      ${renderStepBar(activeStep)}
      ${flash ? renderInlineFlash(flash) : ''}
      ${renderGuestStateHero(entry, guestSession)}
      ${renderGuestStateCards({ slug, entry, venue, bill, guestSession, tableCartSummary })}
    `;

  const showShareAction = ['WAITING', 'NOTIFIED', 'SEATED'].includes(entry.status)
    && Boolean(entry.partySession?.joinToken);

  renderPage(renderShell({
    pill: 'Guest',
    body,
    right: `
      ${showShareAction ? '<button class="btn btn-secondary btn-sm" id="guest-invite-cta" type="button">Invite others</button>' : ''}
      <a class="btn btn-secondary btn-sm" data-nav href="/">Exit</a>
    `,
  }), `Flock | ${venue.name}`);

  if (showShareAction) {
    preloadPartyInviteQr(slug, entry.partySession.joinToken, 240);
    document.getElementById('guest-invite-cta')?.addEventListener('click', () => {
      openShareSheet({ slug, joinToken: entry.partySession.joinToken });
    });
  }

  if (entry.status === 'SEATED') {
    if (!['menu', 'bucket', 'ordered'].includes(uiState.guestTray)) {
      uiState.guestTray = 'menu';
    }
    if (!uiState.guestTrayUserChosen) {
      uiState.guestTray = 'menu';
    }
    mountSeatedGuestExperience({ slug, entry, venue, bill, guestSession });
    return;
  }

  document.getElementById('preorder-cta')?.addEventListener('click', () => {
    navigate(`/v/${slug}/e/${entryId}/preorder`);
  });

  document.getElementById('final-pay-cta')?.addEventListener('click', async () => {
    if (uiState.paymentSubmitting) return;

    const button = document.getElementById('final-pay-cta');
    uiState.paymentSubmitting = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing payment...';
    }

    try {
      await runHostedPayment({
        title: 'Flock final bill',
        initiatePath: '/payments/final/initiate',
        initiateBody: {
          venueId: venue.id,
          queueEntryId: entryId,
        },
        capturePath: '/payments/final/capture',
        prefill: {
          name: entry.guestName,
          contact: entry.guestPhone,
        },
        auth: 'guest',
        guestToken: guestSession.guestToken,
        apiRequest,
      });
      setFlash('green', 'Final payment captured.');
      await renderGuestEntry(slug, entryId);
    } catch (error) {
      setFlash('red', error.message);
      await renderGuestEntry(slug, entryId);
    } finally {
      uiState.paymentSubmitting = false;
    }
  });

  document.getElementById('guest-done-cta')?.addEventListener('click', () => {
    clearGuestSession(entryId);
    clearGuestEntryId(slug);
    setTableCart(entryId, {});
    navigate(`/v/${slug}`);
  });

  document.getElementById('recover-guest-session-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (uiState.guestSessionRestoring) return;

    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    uiState.guestSessionRestoring = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Restoring...';
    }

    const otp = document.getElementById('guest-session-otp').value.trim();

    try {
      const session = await apiRequest(`/queue/${entryId}/session`, {
        method: 'POST',
        body: { otp },
      });
      setGuestSession({
        entryId,
        venueSlug: slug,
        venueId: venue.id,
        guestToken: session.guestToken,
        otp: guestSession?.otp || otp,
      });
      setFlash('green', 'Guest ordering session restored.');
      await renderGuestEntry(slug, entryId);
    } catch (error) {
      setFlash('red', error.message);
      await renderGuestEntry(slug, entryId);
    } finally {
      uiState.guestSessionRestoring = false;
    }
  });

  if (['WAITING', 'NOTIFIED'].includes(entry.status)) {
    if (!uiState.shareSheetOpen) {
      scheduleRefresh(() => renderGuestEntry(slug, entryId), 5000);
    }
  }
}

async function renderGuestSessionJoin(slug, joinToken) {
  const venue = await apiRequest(`/venues/${slug}`);
  const flash = consumeFlash();

  renderPage(renderShell({
    pill: 'Join',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      <div class="card join-session-card">
        <div class="card-title">Join this table session</div>
        <div class="card-sub">Enter your name to join the active table and order with the group.</div>
        <form id="join-party-session-form">
          <div class="form-group">
            <label class="form-label" for="join-display-name">Your name</label>
            <input class="form-input" id="join-display-name" required maxlength="48" placeholder="Aditi">
          </div>
          <div id="join-party-session-error"></div>
          <div class="row">
            <a class="btn btn-secondary" data-nav href="/v/${slug}">Back to venue</a>
            <button class="btn btn-primary" id="join-party-session-submit" type="submit">
              ${uiState.sessionJoinSubmitting ? 'Joining...' : 'Join table'}
            </button>
          </div>
        </form>
      </div>
    `,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/v/${slug}">Venue</a>`,
  }), `Flock | Join ${venue.name}`);

  document.getElementById('join-party-session-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (uiState.sessionJoinSubmitting) return;

    const nameInput = document.getElementById('join-display-name');
    const errorHost = document.getElementById('join-party-session-error');
    const submitButton = document.getElementById('join-party-session-submit');
    const displayName = nameInput?.value.trim();

    if (!displayName) {
      if (errorHost) {
        errorHost.innerHTML = renderInlineFlash({ kind: 'red', message: 'Enter your name to continue.' });
      }
      return;
    }

    uiState.sessionJoinSubmitting = true;
    uiState.sessionJoinError = '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Joining...';
    }
    if (errorHost) {
      errorHost.innerHTML = '';
    }

    try {
      const payload = await apiRequest(`/party-sessions/join/${encodeURIComponent(joinToken)}`, {
        method: 'POST',
        body: { displayName },
      });
      const existingSession = getGuestSession(payload.queueEntryId);
      setGuestEntryId(slug, payload.queueEntryId);
      setGuestSession({
        entryId: payload.queueEntryId,
        venueSlug: slug,
        venueId: payload.venueId,
        guestToken: payload.guestToken,
        otp: existingSession?.otp || '',
        isPartyJoiner: true,
        partySessionId: payload.sessionId,
        participantId: payload.participant?.id || null,
      });
      setFlash('green', `Joined ${venue.name}.`);
      navigate(`/v/${slug}/e/${payload.queueEntryId}`);
    } catch (error) {
      const message = /invalid|expired/i.test(error.message)
        ? 'This invite is invalid or expired.'
        : error.message;
      uiState.sessionJoinError = message;
      if (errorHost) {
        errorHost.innerHTML = renderInlineFlash({ kind: 'red', message });
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Join table';
      }
    } finally {
      uiState.sessionJoinSubmitting = false;
    }
  });
}

function buildPartyInviteUrl(slug, joinToken) {
  return `${window.location.origin}/v/${slug}/session/${encodeURIComponent(joinToken)}`;
}

function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      if (!ok) {
        reject(new Error('Clipboard unavailable'));
        return;
      }
      resolve();
    } catch (error) {
      document.body.removeChild(input);
      reject(error);
    }
  });
}

async function copyPartyInviteLink(slug, joinToken) {
  const inviteUrl = buildPartyInviteUrl(slug, joinToken);
  await copyToClipboard(inviteUrl);
  setFlash('green', 'Invite link copied');
  uiState.shareLink = inviteUrl;
}

function buildInviteQrImageUrl(inviteUrl, size = 240) {
  return `${API_BASE}/share/qr?data=${encodeURIComponent(inviteUrl)}&size=${size}`;
}

function preloadPartyInviteQr(slug, joinToken, size = 240) {
  const inviteUrl = buildPartyInviteUrl(slug, joinToken);
  const qrUrl = buildInviteQrImageUrl(inviteUrl, size);

  if (uiState.shareQrKey === inviteUrl && uiState.shareQrSrc === qrUrl) {
    return qrUrl;
  }

  uiState.shareQrKey = inviteUrl;
  uiState.shareQrSrc = qrUrl;

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = qrUrl;

  return qrUrl;
}

async function renderPartyInviteQr(targetEl, inviteUrl, size = 240) {
  if (!targetEl) return;

  uiState.shareQrLoading = true;
  targetEl.innerHTML = '<div class="share-qr-loading">Loading QR…</div>';

  try {
    const image = new Image();
    image.className = 'share-qr-image';
    image.alt = 'Invite QR code';
    image.decoding = 'async';
    image.loading = 'lazy';
    image.addEventListener('load', () => {
      uiState.shareQrLoading = false;
      targetEl.innerHTML = '';
      targetEl.appendChild(image);
    }, { once: true });
    image.addEventListener('error', () => {
      uiState.shareQrLoading = false;
      targetEl.innerHTML = '<div class="alert alert-amber"><div>QR is unavailable right now, but the invite link still works.</div></div>';
    }, { once: true });
    image.src = uiState.shareQrSrc || buildInviteQrImageUrl(inviteUrl, size);
  } catch (_error) {
    uiState.shareQrLoading = false;
    targetEl.innerHTML = '<div class="alert alert-amber"><div>QR is unavailable right now, but the invite link still works.</div></div>';
  }
}

async function sharePartyInvite(slug, joinToken) {
  const inviteUrl = buildPartyInviteUrl(slug, joinToken);
  if (typeof navigator.share !== 'function') {
    throw new Error('Native sharing is unavailable on this browser');
  }

  await navigator.share({
    title: 'Join this Flock table session',
    text: 'Join this table session and order with the group.',
    url: inviteUrl,
  });
}

function renderShareSheetContent() {
  const inviteUrl = uiState.shareLink;
  const canUseNativeShare = typeof navigator.share === 'function';

  return `
    <div class="share-sheet-panel">
      <div class="share-sheet-handle"></div>
      <div class="section-head share-sheet-head">
        <div class="section-title">Invite others</div>
        <div class="section-sub">Invite others to join this table session.</div>
      </div>
      <div class="share-link-row">
        <div class="share-link-preview">${escapeHtml(inviteUrl)}</div>
        <button class="btn btn-secondary" id="share-copy-link" type="button">Copy</button>
      </div>
      <div class="share-qr-panel">
        <div class="share-qr-frame" id="share-qr-inline-host"></div>
      </div>
      ${canUseNativeShare ? `
        <button class="btn btn-secondary btn-full" id="share-native-share" type="button">Share</button>
      ` : ''}
      <button class="btn btn-secondary btn-full" id="share-close-sheet" type="button">Close</button>
    </div>
  `;
}

function mountShareSheet() {
  const existingBackdrop = document.getElementById('share-sheet-backdrop');
  existingBackdrop?.remove();

  if (!uiState.shareSheetOpen || !uiState.shareContext) {
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'share-sheet-backdrop';
  backdrop.className = 'share-sheet-backdrop';
  backdrop.innerHTML = renderShareSheetContent();
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      closeShareSheet();
    }
  });

  backdrop.querySelector('#share-close-sheet')?.addEventListener('click', () => closeShareSheet());
  backdrop.querySelector('#share-copy-link')?.addEventListener('click', async () => {
    try {
      await copyPartyInviteLink(uiState.shareContext.slug, uiState.shareContext.joinToken);
    } catch (_error) {
      backdrop.querySelector('.share-sheet-head')?.insertAdjacentHTML(
        'afterend',
        renderInlineFlash({ kind: 'amber', message: 'Copy failed. Select the invite link manually.' }),
      );
    }
  });
  backdrop.querySelector('#share-native-share')?.addEventListener('click', async () => {
    try {
      await sharePartyInvite(uiState.shareContext.slug, uiState.shareContext.joinToken);
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      backdrop.querySelector('.share-sheet-head')?.insertAdjacentHTML(
        'afterend',
        renderInlineFlash({ kind: 'amber', message: 'Sharing is unavailable right now. Copy the invite link instead.' }),
      );
    }
  });

  renderPartyInviteQr(
    backdrop.querySelector('#share-qr-inline-host'),
    uiState.shareLink,
    240,
  );
}

function openShareSheet({ slug, joinToken }) {
  clearTimer();
  uiState.shareContext = { slug, joinToken };
  uiState.shareLink = buildPartyInviteUrl(slug, joinToken);
  preloadPartyInviteQr(slug, joinToken, 240);
  uiState.shareSheetOpen = true;
  mountShareSheet();
}

function closeShareSheet(options = {}) {
  const keepState = options.keepState === true;
  uiState.shareSheetOpen = false;
  if (!keepState) {
    uiState.shareLink = '';
    uiState.shareQrKey = '';
    uiState.shareQrSrc = '';
    uiState.shareContext = null;
  }
  document.getElementById('share-sheet-backdrop')?.remove();
}

async function renderPreorder(slug, entryId) {
  const guestSession = getGuestSession(entryId);
  if (!guestSession?.guestToken) {
    setFlash('amber', 'Restore the guest session before placing a pre-order.');
    navigate(`/v/${slug}/e/${entryId}`);
    return;
  }

  const [venue, entry] = await Promise.all([
    apiRequest(`/venues/${slug}`),
    apiRequest(`/queue/${entryId}`, {
      auth: 'guest',
      guestToken: guestSession.guestToken,
    }),
  ]);

  if (!['WAITING', 'NOTIFIED'].includes(entry.status)) {
    setFlash('amber', 'Pre-order is only available while the guest is still in queue.');
    navigate(`/v/${slug}/e/${entryId}`);
    return;
  }

  if (entry.depositPaid > 0) {
    setFlash('amber', 'A deposit-backed pre-order already exists for this entry.');
    navigate(`/v/${slug}/e/${entryId}`);
    return;
  }

  const flash = consumeFlash();
  const cart = getCart(entryId);
  const cartSummary = buildCartSummary(venue.menuCategories || [], cart);

  renderPage(renderShell({
    pill: 'Pre-order',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      <div class="preorder-page-shell">
        <div class="section-head">
          <div class="section-title">Pre-order while waiting</div>
          <div class="section-sub">Build the deposit-backed round here. The summary stays reachable on mobile while you browse.</div>
        </div>
        <div class="grid grid-2 preorder-grid">
          <div class="preorder-menu-shell">
            ${(venue.menuCategories || []).length ? renderGuestCategoryTabs(venue.menuCategories || [], uiState.guestMenuActiveCategory || venue.menuCategories?.[0]?.id || null) : ''}
            ${renderMenuSections(venue.menuCategories || [], cart)}
          </div>
          <div class="card preorder-summary-card">
            <div class="card-title">Order summary</div>
            <div class="card-sub">Deposit required: ${venue.depositPercent}% of the GST-inclusive order value.</div>
            ${cartSummary.lines.length ? cartSummary.lines.map((line) => `
              <div class="order-line">
                <div>
                  <div class="order-line-name">${escapeHtml(line.name)}</div>
                  <div class="order-line-qty">${line.quantity} x ${formatMoney(line.unitTotal)}</div>
                </div>
                <div class="order-line-price">${formatMoney(line.total)}</div>
              </div>
            `).join('') : '<div class="empty-state">Add items to build the pre-order.</div>'}
            <div class="order-total">
              <div class="order-total-label">Total incl GST</div>
              <div class="order-total-val">${formatMoney(cartSummary.total)}</div>
            </div>
            <div class="row" style="margin-top:16px;">
              <a class="btn btn-secondary" data-nav href="/v/${slug}/e/${entryId}">Back</a>
              <button class="btn btn-primary" data-submit-preorder ${cartSummary.lines.length ? '' : 'disabled'}>${uiState.preorderSubmitting ? 'Preparing payment...' : 'Pay deposit'}</button>
            </div>
          </div>
        </div>
        <div class="mobile-order-dock">
          <div class="mobile-order-dock-main">
            <div class="mobile-order-dock-meta">${cartSummary.lines.reduce((sum, line) => sum + line.quantity, 0)} items · Deposit ${venue.depositPercent}%</div>
            <div class="mobile-order-dock-total">${formatMoney(cartSummary.total)}</div>
          </div>
          <button class="btn btn-primary" data-submit-preorder ${cartSummary.lines.length ? '' : 'disabled'}>${uiState.preorderSubmitting ? 'Preparing payment...' : 'Pay deposit'}</button>
        </div>
      </div>
    `,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/v/${slug}/e/${entryId}">Back</a>`,
  }), `Flock | Pre-order`);

  document.querySelectorAll('[data-category-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      const categoryId = button.getAttribute('data-category-jump');
      uiState.guestMenuActiveCategory = categoryId;
      const target = document.getElementById(`guest-category-${categoryId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  mountGuestCategoryTracking();

  document.querySelectorAll('[data-cart-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const menuItemId = button.getAttribute('data-item-id');
      const delta = Number(button.getAttribute('data-delta'));
      updateCart(entryId, menuItemId, delta);
      renderPreorder(slug, entryId).catch(handleFatalError);
    });
  });

  document.querySelectorAll('[data-submit-preorder]').forEach((submitButton) => submitButton.addEventListener('click', async () => {
    if (uiState.preorderSubmitting) return;

    uiState.preorderSubmitting = true;
    document.querySelectorAll('[data-submit-preorder]').forEach((button) => {
      button.disabled = true;
      button.textContent = 'Preparing payment...';
    });

    try {
      const order = await apiRequest('/orders/preorder', {
        method: 'POST',
        auth: 'guest',
        guestToken: guestSession.guestToken,
        body: {
          queueEntryId: entryId,
          items: cartSummary.lines.map((line) => ({
            menuItemId: line.id,
            quantity: line.quantity,
          })),
        },
      });

      await runHostedPayment({
        title: 'Flock deposit',
        initiatePath: '/payments/deposit/initiate',
        initiateBody: {
          venueId: venue.id,
          queueEntryId: entryId,
          orderId: order.id,
        },
        capturePath: '/payments/deposit/capture',
        prefill: {
          name: entry.guestName,
          contact: entry.guestPhone,
        },
        auth: 'guest',
        guestToken: guestSession.guestToken,
        apiRequest,
      });

      setCart(entryId, {});
      setFlash('green', 'Deposit captured. Your pre-order is now locked in.');
      navigate(`/v/${slug}/e/${entryId}`);
    } catch (error) {
      setFlash('red', error.message);
      await renderPreorder(slug, entryId);
    } finally {
      uiState.preorderSubmitting = false;
    }
  }));
}

async function renderStaffLogin() {
  const venue = await apiRequest(`/venues/${DEFAULT_VENUE_SLUG}`);
  const pendingPhone = sessionStorage.getItem(STAFF_PENDING_PHONE_KEY) || '';
  const flash = consumeFlash();

  if (getStaffAuth()) {
    navigate('/staff/dashboard');
    return;
  }

  renderPage(renderShell({
    pill: 'Staff',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      <div class="section-head">
        <div class="section-title">Staff OTP login</div>
        <div class="section-sub">${escapeHtml(venue.name)} closed-pilot console.</div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Send OTP</div>
          <div class="card-sub">Use one of the seeded pilot staff phone numbers for local testing.</div>
          <form id="staff-send-form">
            <div class="form-group">
              <label class="form-label" for="staff-phone">Phone</label>
              <input class="form-input" id="staff-phone" required placeholder="9000000002" value="${escapeHtml(pendingPhone)}">
            </div>
            <button class="btn btn-primary btn-full" type="submit">Send OTP</button>
          </form>
        </div>
        <div class="card">
          <div class="card-title">Verify OTP</div>
          <div class="card-sub">Local dev with mock notifications still uses the same verification flow.</div>
          <form id="staff-verify-form">
            <div class="form-group">
              <label class="form-label" for="staff-code">OTP code</label>
              <input class="form-input" id="staff-code" required maxlength="6" placeholder="123456">
            </div>
            <button class="btn btn-secondary btn-full" type="submit">Verify &amp; enter</button>
          </form>
        </div>
      </div>
    `,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/">Exit</a>`,
  }), 'Flock | Staff login');

  document.getElementById('staff-send-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = normalisePhone(document.getElementById('staff-phone').value);
    try {
      const result = await apiRequest('/auth/staff/otp/send', {
        method: 'POST',
        body: { phone, venueId: venue.id },
      });
      sessionStorage.setItem(STAFF_PENDING_PHONE_KEY, phone);
      if (result?.mockOtp) {
        sessionStorage.setItem('flock_staff_mock_otp', result.mockOtp);
        setFlash('green', `[Demo] OTP auto-filled: ${result.mockOtp}`);
      } else {
        setFlash('green', 'OTP sent. Enter the code to access the console.');
      }
      await renderStaffLogin();
      if (result?.mockOtp) {
        const codeInput = document.getElementById('staff-code');
        if (codeInput) codeInput.value = result.mockOtp;
      }
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffLogin();
    }
  });

  document.getElementById('staff-verify-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = normalisePhone(sessionStorage.getItem(STAFF_PENDING_PHONE_KEY) || document.getElementById('staff-phone').value);
    const code = document.getElementById('staff-code').value.trim();
    try {
      const auth = await apiRequest('/auth/staff/otp/verify', {
        method: 'POST',
        body: { phone, code, venueId: venue.id },
      });
      localStorage.setItem(STAFF_AUTH_KEY, JSON.stringify({ ...auth, venueSlug: DEFAULT_VENUE_SLUG, venueId: venue.id }));
      sessionStorage.removeItem(STAFF_PENDING_PHONE_KEY);
      navigate('/staff/dashboard');
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffLogin();
    }
  });
}

async function renderAdminLogin() {
  const venue = await apiRequest(`/venues/${DEFAULT_VENUE_SLUG}`);
  const pendingPhone = sessionStorage.getItem(ADMIN_PENDING_PHONE_KEY) || '';
  const flash = consumeFlash();

  if (getStaffAuth() && isManagerRole(getStaffAuth().staff?.role)) {
    navigate('/admin/dashboard');
    return;
  }

  renderPage(renderShell({
    pill: 'Admin',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      <div class="section-head">
        <div class="section-title">Admin OTP login</div>
        <div class="section-sub">${escapeHtml(venue.name)} menu and category operations.</div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Send OTP</div>
          <div class="card-sub">Use an owner or manager number. Admin access is intentionally role-gated.</div>
          <form id="admin-send-form">
            <div class="form-group">
              <label class="form-label" for="admin-phone">Phone</label>
              <input class="form-input" id="admin-phone" required placeholder="9000000002" value="${escapeHtml(pendingPhone)}">
            </div>
            <button class="btn btn-primary btn-full" type="submit">Send OTP</button>
          </form>
        </div>
        <div class="card">
          <div class="card-title">Verify OTP</div>
          <div class="card-sub">Admin uses the same OTP rail as staff, but only owner and manager roles continue past this gate.</div>
          <form id="admin-verify-form">
            <div class="form-group">
              <label class="form-label" for="admin-code">OTP code</label>
              <input class="form-input" id="admin-code" required maxlength="6" placeholder="123456">
            </div>
            <button class="btn btn-secondary btn-full" type="submit">Verify &amp; enter</button>
          </form>
        </div>
      </div>
    `,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/">Exit</a>`,
  }), 'Flock | Admin login');

  document.getElementById('admin-send-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = normalisePhone(document.getElementById('admin-phone').value);
    try {
      const result = await apiRequest('/auth/staff/otp/send', {
        method: 'POST',
        body: { phone, venueId: venue.id },
      });
      sessionStorage.setItem(ADMIN_PENDING_PHONE_KEY, phone);
      if (result?.mockOtp) {
        setFlash('green', `[Demo] OTP auto-filled: ${result.mockOtp}`);
      } else {
        setFlash('green', 'OTP sent. Admin access still requires a manager or owner role.');
      }
      await renderAdminLogin();
      if (result?.mockOtp) {
        const codeInput = document.getElementById('admin-code');
        if (codeInput) codeInput.value = result.mockOtp;
      }
    } catch (error) {
      setFlash('red', error.message);
      await renderAdminLogin();
    }
  });

  document.getElementById('admin-verify-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = normalisePhone(sessionStorage.getItem(ADMIN_PENDING_PHONE_KEY) || document.getElementById('admin-phone').value);
    const code = document.getElementById('admin-code').value.trim();

    try {
      const auth = await apiRequest('/auth/staff/otp/verify', {
        method: 'POST',
        body: { phone, code, venueId: venue.id },
      });

      if (!isManagerRole(auth.staff?.role)) {
        sessionStorage.removeItem(ADMIN_PENDING_PHONE_KEY);
        setFlash('red', 'This staff role cannot open the admin console.');
        await renderAdminLogin();
        return;
      }

      localStorage.setItem(STAFF_AUTH_KEY, JSON.stringify({ ...auth, venueSlug: DEFAULT_VENUE_SLUG, venueId: venue.id }));
      sessionStorage.removeItem(ADMIN_PENDING_PHONE_KEY);
      navigate('/admin/dashboard');
    } catch (error) {
      setFlash('red', error.message);
      await renderAdminLogin();
    }
  });
}

async function renderStaffDashboard() {
  const auth = getStaffAuth();
  if (!auth) {
    navigate('/staff/login');
    return;
  }
  let venue = {
    name: 'Venue unavailable',
    isQueueOpen: true,
    depositPercent: 75,
    tableReadyWindowMin: 10,
  };
  let queue = [];
  const currentTab = uiState.staffTab;
  const fetchPlan = buildStaffDashboardFetchPlan({
    currentTab,
    tablesFetchedAt: uiState.staffTablesFetchedAt,
    recentTableEventsFetchedAt: uiState.staffRecentTableEventsFetchedAt,
  });
  let tables = uiState.staffTables || [];
  let stats = uiState.staffStats || EMPTY_VENUE_STATS;
  let recentTableEvents = uiState.staffRecentTableEvents || [];
  const dependencyWarnings = [];

  const [venueResult, queueResult, tablesResult, eventsResult] = await Promise.allSettled([
    apiRequest(`/venues/${auth.venueSlug || DEFAULT_VENUE_SLUG}`),
    apiRequest('/queue/live', { auth: true }),
    fetchPlan.shouldFetchTables
      ? apiRequest('/tables', { auth: true })
      : Promise.resolve(tables),
    fetchPlan.shouldFetchRecentTableEvents
      ? apiRequest('/tables/events/recent', { auth: true })
      : Promise.resolve(recentTableEvents),
  ]);

  if (venueResult.status === 'fulfilled') {
    venue = venueResult.value;
  } else if (isAuthErrorMessage(venueResult.reason?.message)) {
    clearStaffAuth();
    navigate('/staff/login');
    return;
  } else {
    dependencyWarnings.push('Venue details');
  }

  if (queueResult.status === 'fulfilled') {
    queue = queueResult.value;
  } else if (isAuthErrorMessage(queueResult.reason?.message)) {
    clearStaffAuth();
    navigate('/staff/login');
    return;
  } else {
    dependencyWarnings.push('Live queue');
  }

  if (tablesResult.status === 'fulfilled') {
    tables = tablesResult.value;
    if (fetchPlan.shouldFetchTables) {
      uiState.staffTables = tables;
      uiState.staffTablesFetchedAt = Date.now();
    }
  } else if (isAuthErrorMessage(tablesResult.reason?.message)) {
    clearStaffAuth();
    navigate('/staff/login');
    return;
  } else if (fetchPlan.needsTables) {
    dependencyWarnings.push('Tables');
  }

  if (eventsResult.status === 'fulfilled') {
    recentTableEvents = eventsResult.value;
    if (fetchPlan.shouldFetchRecentTableEvents) {
      uiState.staffRecentTableEvents = recentTableEvents;
      uiState.staffRecentTableEventsFetchedAt = Date.now();
    }
  } else if (isAuthErrorMessage(eventsResult.reason?.message)) {
    clearStaffAuth();
    navigate('/staff/login');
    return;
  } else if (fetchPlan.needsRecentTableEvents) {
    dependencyWarnings.push('Table events');
  }

  if (!uiState.staffStatsFetchedAt || (Date.now() - uiState.staffStatsFetchedAt) >= 60000) {
    uiState.staffStatsFetchedAt = Date.now();
    try {
      stats = await apiRequest('/venues/stats/today', { auth: true });
      uiState.staffStats = stats;
    } catch (error) {
      if (isAuthErrorMessage(error.message)) {
        clearStaffAuth();
        navigate('/staff/login');
        return;
      }
      if (isTransientServiceErrorMessage(error.message)) {
        dependencyWarnings.push('Venue stats');
      }
      stats = uiState.staffStats || EMPTY_VENUE_STATS;
    }
  }

  const flash = consumeFlash();
  const waiting = queue.filter((entry) => entry.status === 'WAITING' || entry.status === 'NOTIFIED');
  const seated = queue.filter((entry) => entry.status === 'SEATED');
  let seatedBills = uiState.staffSeatedBills;
  const shouldRefreshSeatedBills = currentTab === 'seated'
    && (
      !uiState.staffLastUpdatedAt
      || (Date.now() - uiState.staffLastUpdatedAt) >= 10000
      || seated.some((entry) => !(entry.id in uiState.staffSeatedBills))
    );

  if (shouldRefreshSeatedBills) {
    seatedBills = await loadSeatedBills(seated);
    uiState.staffSeatedBills = seatedBills;
    uiState.staffLastUpdatedAt = Date.now();
  }

  if (currentTab === 'history' && (Date.now() - uiState.staffHistoryLoadedAt) >= 15000) {
    try {
      const history = await apiRequest('/queue/history/recent', { auth: true });
      uiState.staffHistory = history;
      uiState.staffHistoryLoadedAt = Date.now();
    } catch (error) {
      if (isAuthErrorMessage(error.message)) { clearStaffAuth(); navigate('/staff/login'); return; }
      dependencyWarnings.push('History');
    }
  }

  renderPage(renderShell({
    pill: 'Staff',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      ${renderDependencyWarnings(dependencyWarnings)}
      <div class="section-head">
        <div class="section-title">Floor command</div>
        <div class="section-sub">${escapeHtml(auth.staff.name)} · ${escapeHtml(auth.staff.role)} · ${escapeHtml(venue.name)}</div>
      </div>
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-tile">
          <div class="stat-label">Queue joins</div>
          <div class="stat-value">${stats.today.totalQueueJoins}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Avg wait</div>
          <div class="stat-value">${stats.today.avgWaitMin}m</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Captured revenue</div>
          <div class="stat-value">${formatMoney(stats.today.totalRevenuePaise)}</div>
        </div>
      </div>
      <div class="tabs">
        ${renderTabButton('queue', 'Queue', currentTab)}
        ${renderTabButton('seated', 'Seated', currentTab)}
        ${renderTabButton('history', 'History', currentTab)}
        ${renderTabButton('tables', 'Tables', currentTab)}
        ${renderTabButton('seat', 'Seat OTP', currentTab)}
        ${renderTabButton('manager', 'Manager', currentTab)}
      </div>
      ${currentTab === 'queue' ? renderQueueTab(waiting, tables) : ''}
      ${currentTab === 'seated' ? renderSeatedTab(seated, seatedBills) : ''}
      ${currentTab === 'history' ? renderHistoryTab() : ''}
      ${currentTab === 'tables' ? renderTablesTab(tables, recentTableEvents) : ''}
      ${currentTab === 'seat' ? renderSeatTab(tables) : ''}
      ${currentTab === 'manager' ? renderManagerTab({ auth, venue, queue }) : ''}
    `,
    right: `
      <div class="tms-indicator"><span class="tms-dot"></span> Manual floor active</div>
      <button class="btn btn-secondary btn-sm" id="staff-logout">Logout</button>
    `,
  }), 'Flock | Staff dashboard');

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      uiState.staffTab = button.getAttribute('data-tab');
      renderStaffDashboard().catch(handleFatalError);
    });
  });

  scrollActiveTabIntoView();

  document.getElementById('staff-logout')?.addEventListener('click', () => {
    clearStaffAuth();
    navigate('/staff/login');
  });

  document.querySelectorAll('[data-prefill-seat]').forEach((button) => {
    button.addEventListener('click', () => {
      const otp = button.getAttribute('data-prefill-seat') || '';
      const entryId = button.getAttribute('data-entry-id') || null;
      const suggestedTableId = button.getAttribute('data-suggested-table') || '';
      setSeatOtpFromString(otp);
      uiState.staffSeat.prefilledFromQueueId = entryId;
      uiState.staffSeat.suggestedTableId = suggestedTableId || null;
      uiState.staffSeat.tableId = suggestedTableId || uiState.staffSeat.tableId;
      uiState.staffSeat.error = '';
      uiState.staffSeat.success = entryId ? 'Guest OTP prefilled from the queue. Confirm the table and seat them.' : '';
      uiState.staffTab = 'seat';
      renderStaffDashboard().catch(handleFatalError);
    });
  });

  document.querySelectorAll('[data-cancel-entry]').forEach((button) => {
    const entryId = button.getAttribute('data-cancel-entry');
    button.addEventListener('click', guardedAction(`cancel-${entryId}`, async () => {
      try {
        await apiRequest(`/queue/${entryId}`, { method: 'DELETE', auth: true });
        setFlash('green', 'Queue entry cancelled.');
        await renderStaffDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderStaffDashboard();
      }
    }));
  });

  document.querySelectorAll('[data-checkout-entry]').forEach((button) => {
    const entryId = button.getAttribute('data-checkout-entry');
    button.addEventListener('click', guardedAction(`checkout-${entryId}`, async () => {
      try {
        await apiRequest(`/queue/${entryId}/checkout`, { method: 'POST', auth: true });
        setFlash('green', 'Guest checked out.');
        await renderStaffDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderStaffDashboard();
      }
    }));
  });

  document.querySelectorAll('[data-view-flow]').forEach((button) => {
    const entryId = button.getAttribute('data-view-flow');
    button.addEventListener('click', guardedAction(`flow-${entryId}`, async () => {
      try {
        const events = await apiRequest(`/queue/${entryId}/flow`, { auth: true });
        showFlowLogModal(entryId, events);
      } catch (error) {
        setFlash('red', `Could not load flow log: ${error.message}`);
        await renderStaffDashboard();
      }
    }));
  });

  document.querySelectorAll('[data-table-status]').forEach((button) => {
    const tableId = button.getAttribute('data-table-id');
    const status = button.getAttribute('data-table-status');
    button.addEventListener('click', guardedAction(`table-${tableId}-${status}`, async () => {
      try {
        await apiRequest(`/tables/${tableId}/status`, { method: 'PATCH', auth: true, body: { status } });
        setFlash('green', 'Table status updated.');
        await renderStaffDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderStaffDashboard();
      }
    }));
  });

  document.getElementById('seat-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const otp = getSeatOtp();
    const tableId = document.getElementById('seat-table').value;
    if (otp.length !== 6 || !tableId) {
      uiState.staffSeat.error = 'Enter the full 6-digit guest OTP and select a table.';
      uiState.staffSeat.success = '';
      await renderStaffDashboard();
      return;
    }
    uiState.staffSeat.tableId = tableId;
    uiState.staffSeat.error = '';
    uiState.staffSeat.success = '';
    uiState.staffSeat.isSubmitting = true;
    await renderStaffDashboard();

    try {
      const result = await apiRequest('/queue/seat', {
        method: 'POST',
        auth: true,
        body: { otp, tableId },
      });
      resetStaffSeatState();
      uiState.staffSeat.success = `Guest seated. Pre-order sync: ${result.preOrderSync.status}.`;
      uiState.staffTab = 'seat';
      await renderStaffDashboard();
    } catch (error) {
      uiState.staffSeat.error = error.message;
      uiState.staffSeat.isSubmitting = false;
      await renderStaffDashboard();
    }
  });

  document.querySelectorAll('[data-seat-digit]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const index = Number(event.target.getAttribute('data-index'));
      const value = String(event.target.value || '').replace(/\D/g, '').slice(-1);
      uiState.staffSeat.otpDigits[index] = value;
      event.target.value = value;
      uiState.staffSeat.error = '';
      uiState.staffSeat.success = '';
      if (value && index < 5) {
        document.querySelector(`[data-seat-digit][data-index="${index + 1}"]`)?.focus();
      }
    });

    input.addEventListener('keydown', (event) => {
      const index = Number(event.target.getAttribute('data-index'));
      if (event.key === 'Backspace') {
        if (event.target.value) {
          uiState.staffSeat.otpDigits[index] = '';
          event.target.value = '';
        } else if (index > 0) {
          const prev = document.querySelector(`[data-seat-digit][data-index="${index - 1}"]`);
          prev?.focus();
        }
        uiState.staffSeat.error = '';
        uiState.staffSeat.success = '';
      }
    });

    input.addEventListener('paste', (event) => {
      event.preventDefault();
      const pasted = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!pasted) return;
      setSeatOtpFromString(pasted);
      uiState.staffSeat.error = '';
      uiState.staffSeat.success = '';
      renderStaffDashboard().catch(handleFatalError);
    });
  });

  document.getElementById('seat-table')?.addEventListener('change', (event) => {
    uiState.staffSeat.tableId = event.target.value;
    uiState.staffSeat.error = '';
    uiState.staffSeat.success = '';
  });

  document.getElementById('toggle-queue')?.addEventListener('click', guardedAction('toggle-queue', async () => {
    try {
      await apiRequest('/venues/config', { method: 'PATCH', auth: true, body: { isQueueOpen: !venue.isQueueOpen } });
      setFlash('green', `Queue ${venue.isQueueOpen ? 'closed' : 'opened'}.`);
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  }));

  document.getElementById('manager-config-form')?.addEventListener('submit', guardedAction('config-form', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/venues/config', {
        method: 'PATCH', auth: true,
        body: {
          depositPercent: Number(document.getElementById('manager-deposit').value),
          tableReadyWindowMin: Number(document.getElementById('manager-window').value),
        },
      });
      setFlash('green', 'Venue settings updated.');
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  }));

  document.getElementById('offline-settle-form')?.addEventListener('submit', guardedAction('offline-settle', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/payments/final/settle-offline', {
        method: 'POST', auth: true,
        body: { queueEntryId: document.getElementById('offline-queue-entry').value.trim() },
      });
      setFlash('green', 'Final bill marked as settled offline.');
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  }));

  document.getElementById('refund-form')?.addEventListener('submit', guardedAction('refund-form', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/payments/refund', {
        method: 'POST', auth: true,
        body: { paymentId: document.getElementById('refund-payment-id').value.trim() },
      });
      setFlash('green', 'Refund request recorded.');
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  }));

  if (currentTab !== 'seat' && currentTab !== 'manager' && !uiState.staffSeat.isSubmitting) {
    const refreshMs = resolveStaffDashboardRefreshMs({ currentTab, dependencyWarnings });
    scheduleRefresh(() => renderStaffDashboard(), refreshMs);
  }
}

async function renderAdminDashboard() {
  const auth = getStaffAuth();
  if (!auth) {
    navigate('/admin/login');
    return;
  }

  if (!isManagerRole(auth.staff?.role)) {
    renderPage(renderShell({
      pill: 'Admin',
      body: `
        <div class="section-head">
          <div class="section-title">Admin access blocked</div>
          <div class="section-sub">This authenticated role can use the floor console, but not the admin menu tooling.</div>
        </div>
        <div class="card">
          <div class="card-sub">Use a manager or owner account to continue, or return to the staff dashboard.</div>
          <div class="row">
            <a class="btn btn-secondary" data-nav href="/staff/dashboard">Return to staff</a>
            <a class="btn btn-primary" data-nav href="/admin/login">Use manager login</a>
          </div>
        </div>
      `,
      right: `<button class="btn btn-secondary btn-sm" id="admin-logout">Logout</button>`,
    }), 'Flock | Admin blocked');

    document.getElementById('admin-logout')?.addEventListener('click', () => {
      clearStaffAuth();
      navigate('/admin/login');
    });
    return;
  }

  const dependencyWarnings = [];
  let venue = {
    name: 'Venue unavailable',
  };
  let menu = {
    categories: uiState.adminMenu.categories || [],
  };

  const [venueResult, menuResult] = await Promise.allSettled([
    apiRequest(`/venues/${auth.venueSlug || DEFAULT_VENUE_SLUG}`),
    apiRequest('/menu/admin/current', { auth: true }),
  ]);

  if (venueResult.status === 'fulfilled') {
    venue = venueResult.value;
  } else if (isAuthErrorMessage(venueResult.reason?.message)) {
    clearStaffAuth();
    navigate('/admin/login');
    return;
  } else {
    dependencyWarnings.push('Venue details');
  }

  if (menuResult.status === 'fulfilled') {
    menu = menuResult.value;
  } else if (isAuthErrorMessage(menuResult.reason?.message)) {
    clearStaffAuth();
    navigate('/admin/login');
    return;
  } else {
    dependencyWarnings.push('Admin menu');
  }

  const flash = consumeFlash();
  uiState.adminMenu.categories = menu.categories || [];

  renderPage(renderShell({
    pill: 'Admin',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
      ${renderDependencyWarnings(dependencyWarnings)}
      <div class="section-head">
        <div class="section-title">Admin command</div>
        <div class="section-sub">${escapeHtml(auth.staff.name)} · ${escapeHtml(auth.staff.role)} · ${escapeHtml(venue.name)}</div>
      </div>
      <div class="tabs">
        ${renderTabButton('menu', 'Menu', uiState.adminTab)}
        ${renderTabButton('add', 'Add item', uiState.adminTab)}
      </div>
      ${uiState.adminTab === 'menu' ? renderAdminMenuTab(menu.categories || []) : renderAdminAddTab(menu.categories || [])}
    `,
    right: `
      <a class="btn btn-secondary btn-sm" data-nav href="/staff/dashboard">Floor</a>
      <button class="btn btn-secondary btn-sm" id="admin-logout">Logout</button>
    `,
  }), 'Flock | Admin dashboard');

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      uiState.adminTab = button.getAttribute('data-tab');
      renderAdminDashboard().catch(handleFatalError);
    });
  });

  scrollActiveTabIntoView();

  document.getElementById('admin-logout')?.addEventListener('click', () => {
    clearStaffAuth();
    navigate('/admin/login');
  });

  document.querySelectorAll('[data-admin-toggle]').forEach((button) => {
    const itemId = button.getAttribute('data-admin-toggle');
    button.addEventListener('click', guardedAction(`toggle-${itemId}`, async () => {
      try {
        await apiRequest(`/menu/items/${itemId}/toggle`, { method: 'PATCH', auth: true });
        setFlash('green', 'Menu item availability updated.');
        await renderAdminDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderAdminDashboard();
      }
    }));
  });

  document.querySelectorAll('[data-admin-remove]').forEach((button) => {
    const itemId = button.getAttribute('data-admin-remove');
    button.addEventListener('click', guardedAction(`remove-${itemId}`, async () => {
      try {
        await apiRequest(`/menu/items/${itemId}`, { method: 'DELETE', auth: true });
        setFlash('green', 'Menu item removed.');
        await renderAdminDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderAdminDashboard();
      }
    }));
  });

  document.getElementById('admin-category-form')?.addEventListener('submit', guardedAction('create-category', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/menu/categories', {
        method: 'POST', auth: true,
        body: {
          name: document.getElementById('admin-category-name').value.trim(),
          sortOrder: Number(document.getElementById('admin-category-sort').value || 0),
        },
      });
      setFlash('green', 'Category created.');
      await renderAdminDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderAdminDashboard();
    }
  }));

  document.getElementById('admin-item-form')?.addEventListener('submit', guardedAction('create-item', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/menu/items', {
        method: 'POST', auth: true,
        body: {
          categoryId: document.getElementById('admin-item-category').value,
          name: document.getElementById('admin-item-name').value.trim(),
          description: document.getElementById('admin-item-description').value.trim(),
          priceExGst: Math.round(Number(document.getElementById('admin-item-price').value) * 100),
          gstPercent: Number(document.getElementById('admin-item-gst').value),
          isVeg: document.getElementById('admin-item-veg').checked,
          isAlcohol: document.getElementById('admin-item-alcohol').checked,
          sortOrder: Number(document.getElementById('admin-item-sort').value || 0),
        },
      });
      setFlash('green', 'Menu item created.');
      await renderAdminDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderAdminDashboard();
    }
  }));
}

function renderQueueTab(waiting, tables) {
  return waiting.length ? waiting.map((entry) => `
    <div class="q-row ${entry.status === 'NOTIFIED' ? 'highlight' : ''}">
      <div class="q-row-num">${entry.position || '-'}</div>
      <div class="q-row-info">
        <div class="q-row-name">
          ${escapeHtml(entry.guestName)}
          ${renderStatusBadge(entry.status)}
          ${entry.depositPaid > 0 ? '<span class="badge badge-neutral">Deposit</span>' : ''}
          ${entry.preOrderTotal > 0 ? '<span class="badge badge-neutral">Pre-order</span>' : ''}
        </div>
        <div class="q-row-meta">${escapeHtml(entry.guestPhone)} · ${entry.partySize} pax · OTP <span class="mono">${escapeHtml(entry.otp)}</span>${entry.displayRef ? ` · <span class="mono">${escapeHtml(entry.displayRef)}</span>` : ''}</div>
        <div class="q-row-orders">
          ${entry.estimatedWaitMin ? `ETA ~${entry.estimatedWaitMin} mins` : 'Awaiting table match'}
          ${entry.table?.label ? ` · Reserved ${escapeHtml(entry.table.label)}` : ''}
        </div>
        ${entry.orders?.length ? `<div class="q-row-orders">Pre-order: ${escapeHtml(renderGuestOrderItems(entry.orders.flatMap((order) => order.items || [])) || 'Locked items on file')}</div>` : ''}
      </div>
      <div class="q-row-actions">
        <button class="btn btn-secondary btn-sm" data-prefill-seat="${escapeHtml(entry.otp)}" data-entry-id="${entry.id}" data-suggested-table="${getSuggestedTableId(entry, tables)}">Seat</button>
        <button class="btn btn-secondary btn-sm" data-view-flow="${entry.id}">Flow log</button>
        <button class="btn btn-danger btn-sm" data-cancel-entry="${entry.id}">Cancel</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">No waiting or notified guests right now.</div>';
}

function renderSeatedTab(seated, seatedBills) {
  return seated.length ? seated.map((entry) => {
    const bill = seatedBills[entry.id];
    return `
      <div class="q-row">
        <div class="q-row-num">${escapeHtml(entry.table?.label || '-')}</div>
        <div class="q-row-info">
          <div class="q-row-name">
            ${escapeHtml(entry.guestName)}
            <span class="badge badge-seated">Seated</span>
            ${entry.depositPaid > 0 ? '<span class="badge badge-neutral">Deposit</span>' : ''}
          </div>
          <div class="q-row-meta">${escapeHtml(entry.guestPhone)} · ${entry.partySize} pax${entry.table?.section ? ` · ${escapeHtml(entry.table.section)}` : ''}${entry.displayRef ? ` · <span class="mono">${escapeHtml(entry.displayRef)}</span>` : ''}</div>
          <div class="q-row-orders">${entry.orders?.length ? renderGuestOrderItems(entry.orders.flatMap((order) => order.items || [])) : 'No orders posted yet.'}</div>
        </div>
        <div class="q-row-actions" style="align-items:flex-end;">
          <div class="muted">${bill ? `Total ${formatMoney(bill.summary.totalIncGst)}` : 'Loading bill'}</div>
          ${bill ? `<div class="muted">Balance ${formatMoney(bill.summary.balanceDue)}</div>` : ''}
          <button class="btn btn-secondary btn-sm" data-view-flow="${entry.id}" style="margin-top:4px;">Flow log</button>
          <button class="btn btn-secondary btn-sm" data-checkout-entry="${entry.id}" style="margin-top:4px;">Check out</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state">No seated parties are active right now.</div>';
}

function renderHistoryTab() {
  const entries = uiState.staffHistory || [];
  if (!entries.length) return '<div class="empty-state">No completed sessions found yet.</div>';

  const statusLabel = { COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };

  return entries.map((entry) => {
    const totalPaise = (entry.orders || []).reduce((s, o) => s + (o.totalIncGst || 0), 0);
    const statusBadge = entry.status === 'COMPLETED'
      ? '<span class="badge badge-seated">Completed</span>'
      : entry.status === 'CANCELLED'
        ? '<span class="badge badge-danger">Cancelled</span>'
        : `<span class="badge badge-neutral">${escapeHtml(statusLabel[entry.status] || entry.status)}</span>`;
    return `
      <div class="q-row">
        <div class="q-row-num">${entry.table?.label ? escapeHtml(entry.table.label) : '-'}</div>
        <div class="q-row-info">
          <div class="q-row-name">
            ${escapeHtml(entry.guestName)}
            ${statusBadge}
            ${entry.depositPaid > 0 ? '<span class="badge badge-neutral">Deposit</span>' : ''}
          </div>
          <div class="q-row-meta">${escapeHtml(entry.guestPhone)} · ${entry.partySize} pax${entry.displayRef ? ` · <span class="mono">${escapeHtml(entry.displayRef)}</span>` : ''}</div>
          <div class="q-row-meta muted">${formatRelativeStamp(new Date(entry.completedAt || entry.updatedAt).getTime())}</div>
        </div>
        <div class="q-row-actions" style="align-items:flex-end;">
          <div class="muted">${totalPaise ? `Total ${formatMoney(totalPaise)}` : 'No orders'}</div>
          <button class="btn btn-secondary btn-sm" data-view-flow="${entry.id}" style="margin-top:4px;">Flow log</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTablesTab(tables, recentTableEvents) {
  return `
    <div class="floor-plan-header">
      <div>
        <div class="section-title">Table floor</div>
        <div class="section-sub">Manual table state drives queue auto-advance. Last updated ${formatRelativeStamp(uiState.staffLastUpdatedAt)}.</div>
      </div>
      <div class="floor-legend">
        <div class="legend-item"><span class="legend-dot free"></span>Free</div>
        <div class="legend-item"><span class="legend-dot occupied"></span>Occupied</div>
        <div class="legend-item"><span class="legend-dot clearing"></span>Clearing</div>
        <div class="legend-item"><span class="legend-dot reserved"></span>Reserved</div>
      </div>
    </div>
    <div class="tables-grid">
      ${tables.map((table) => `
        <div class="table-card ${table.status.toLowerCase()}">
          <div class="table-num">${escapeHtml(table.label)}</div>
          <div class="table-cap">${table.capacity} seats${table.section ? ` · ${escapeHtml(table.section)}` : ''}</div>
          <div class="table-status-label">${escapeHtml(table.status)}</div>
          <div class="table-actions">
            ${renderTableActions(table)}
          </div>
        </div>
      `).join('')}
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-title">Recent floor events</div>
      <div class="card-sub">Live operator feed powered by venue-scoped table events.</div>
      ${recentTableEvents.length ? recentTableEvents.map((event) => `
        <div class="order-line">
          <div>
            <div class="order-line-name">${escapeHtml(event.tableLabel)} · ${escapeHtml(event.fromStatus)} → ${escapeHtml(event.toStatus)}</div>
            <div class="order-line-qty">${formatRelativeStamp(new Date(event.createdAt).getTime())}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</div>
          </div>
          <div class="order-line-price">${escapeHtml(event.triggeredBy || 'system')}</div>
        </div>
      `).join('') : '<div class="empty-state">No table events captured yet.</div>'}
    </div>
  `;
}

function renderSeatTab(tables) {
  const available = tables.filter((table) => table.status === 'FREE' || table.status === 'RESERVED');
  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Seat by OTP</div>
        <div class="card-sub">Use the 6-digit guest OTP, then explicitly bind the guest to a compatible free or reserved table.</div>
        ${uiState.staffSeat.error ? renderInlineFlash({ kind: 'red', message: uiState.staffSeat.error }) : ''}
        ${uiState.staffSeat.success ? renderInlineFlash({ kind: 'green', message: uiState.staffSeat.success }) : ''}
        ${uiState.staffSeat.prefilledFromQueueId ? `<div class="alert alert-blue"><div>Quick seat loaded from queue row. OTP is prefilled for queue entry <span class="mono">${escapeHtml(uiState.staffSeat.prefilledFromQueueId)}</span>.</div></div>` : ''}
        <form id="seat-form">
          <div class="form-group">
            <label class="form-label">Guest OTP</label>
            <div class="otp-grid">
              ${uiState.staffSeat.otpDigits.map((digit, index) => `
                <input
                  class="form-input otp-digit"
                  data-seat-digit
                  data-index="${index}"
                  inputmode="numeric"
                  maxlength="1"
                  value="${escapeHtml(digit)}"
                  ${uiState.staffSeat.isSubmitting ? 'disabled' : ''}
                >
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="seat-table">Table</label>
            <select class="form-select" id="seat-table" required>
              <option value="">Select a free/reserved table</option>
              ${available.map((table) => `<option value="${table.id}" ${uiState.staffSeat.tableId === table.id ? 'selected' : ''}>${escapeHtml(table.label)} · ${table.status}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-full" type="submit" ${uiState.staffSeat.isSubmitting ? 'disabled' : ''}>
            ${uiState.staffSeat.isSubmitting ? 'Seating...' : 'Seat guest'}
          </button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Operator note</div>
        <div class="card-sub">Deposit-first stays intact. If a guest already prepaid, seating locks the table and triggers the pre-order handoff path.</div>
        <div class="alert alert-blue">
          <div>Queue-row quick seat never bypasses verification. It only preloads the guest OTP and best-fit table to speed up the same PM-faithful step.</div>
        </div>
      </div>
    </div>
  `;
}

function renderManagerTab({ auth, venue, queue }) {
  const isManager = auth.staff.role === 'OWNER' || auth.staff.role === 'MANAGER';
  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Queue control</div>
        <div class="card-sub">Single pilot venue mode. Toggle queue access instantly.</div>
        <div class="row" style="margin-bottom:16px;">
          <span class="badge ${venue.isQueueOpen ? 'badge-ready' : 'badge-neutral'}">${venue.isQueueOpen ? 'Queue open' : 'Queue closed'}</span>
          <button class="btn btn-secondary btn-sm" id="toggle-queue">${venue.isQueueOpen ? 'Close queue' : 'Open queue'}</button>
        </div>
        ${isManager ? `
          <form id="manager-config-form">
            <div class="form-group">
              <label class="form-label" for="manager-deposit">Deposit %</label>
              <input class="form-input" id="manager-deposit" type="number" min="50" max="100" value="${venue.depositPercent}">
            </div>
            <div class="form-group">
              <label class="form-label" for="manager-window">Table ready window (min)</label>
              <input class="form-input" id="manager-window" type="number" min="5" max="60" value="${venue.tableReadyWindowMin}">
            </div>
            <button class="btn btn-primary btn-full" type="submit">Save settings</button>
          </form>
        ` : `
          <div class="alert alert-blue"><div>Manager-only venue controls are hidden for this staff role.</div></div>
        `}
      </div>
      <div class="card">
        <div class="card-title">Operational fallbacks</div>
        <div class="card-sub">These are pilot-safe escape hatches to keep service moving.</div>
        <form id="offline-settle-form" style="margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label" for="offline-queue-entry">Queue entry ID</label>
            <input class="form-input mono" id="offline-queue-entry" placeholder="${queue[0]?.id || 'Queue entry UUID'}">
          </div>
          <button class="btn btn-secondary btn-full" type="submit">Mark final bill settled offline</button>
        </form>
        ${isManager ? `
          <form id="refund-form">
            <div class="form-group">
              <label class="form-label" for="refund-payment-id">Deposit payment ID</label>
              <input class="form-input mono" id="refund-payment-id" placeholder="Payment UUID">
            </div>
            <button class="btn btn-danger btn-full" type="submit">Refund deposit</button>
          </form>
        ` : ''}
      </div>
    </div>
  `;
}

function renderAdminMenuTab(categories) {
  return `
    <div class="card">
      <div class="card-title">Live menu</div>
      <div class="card-sub">Every item is grouped by category. Toggle availability without leaving the service shell.</div>
      ${categories.length ? categories.map((category) => `
        <div style="margin-bottom:18px;">
          <div class="cat-header">
            <div class="cat-header-name">${escapeHtml(category.name)}</div>
            <div class="cat-header-line"></div>
          </div>
          ${(category.items || []).length ? category.items.map((item) => `
            <div class="q-row">
              <div class="q-row-num">${item.isAvailable ? 'On' : 'Off'}</div>
              <div class="q-row-info">
                <div class="q-row-name">
                  ${escapeHtml(item.name)}
                  ${item.isAvailable ? '<span class="badge badge-ready">Live</span>' : '<span class="badge badge-neutral">Disabled</span>'}
                </div>
                <div class="q-row-meta">${escapeHtml(item.description || 'No description')}</div>
                <div class="q-row-orders">${formatMoney(menuItemTotal(item))} · GST ${item.gstPercent}% ${item.isAlcohol ? '· Alcohol' : item.isVeg ? '· Veg' : ''}</div>
              </div>
              <div class="q-row-actions">
                <button class="btn btn-secondary btn-sm" data-admin-toggle="${item.id}">${item.isAvailable ? 'Disable' : 'Enable'}</button>
                <button class="btn btn-danger btn-sm" data-admin-remove="${item.id}">Remove</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">No items in this category yet.</div>'}
        </div>
      `).join('') : '<div class="empty-state">No categories configured yet.</div>'}
    </div>
  `;
}

function renderAdminAddTab(categories) {
  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Add category</div>
        <div class="card-sub">Keep menu growth category-first so the guest ordering surface stays grouped and readable.</div>
        <form id="admin-category-form">
          <div class="form-group">
            <label class="form-label" for="admin-category-name">Category name</label>
            <input class="form-input" id="admin-category-name" required placeholder="Chef specials">
          </div>
          <div class="form-group">
            <label class="form-label" for="admin-category-sort">Sort order</label>
            <input class="form-input" id="admin-category-sort" type="number" min="0" value="0">
          </div>
          <button class="btn btn-secondary btn-full" type="submit">Create category</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Add item</div>
        <div class="card-sub">This uses the live menu API. Category IDs can now use the existing seeded string IDs instead of UUIDs only.</div>
        <form id="admin-item-form">
          <div class="form-group">
            <label class="form-label" for="admin-item-category">Category</label>
            <select class="form-select" id="admin-item-category" required>
              <option value="">Select category</option>
              ${categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="admin-item-name">Item name</label>
            <input class="form-input" id="admin-item-name" required placeholder="Masala peanuts">
          </div>
          <div class="form-group">
            <label class="form-label" for="admin-item-description">Description</label>
            <input class="form-input" id="admin-item-description" placeholder="Fast bar snack">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="admin-item-price">Price (INR)</label>
              <input class="form-input" id="admin-item-price" type="number" min="1" step="0.01" required value="250">
            </div>
            <div class="form-group">
              <label class="form-label" for="admin-item-gst">GST %</label>
              <input class="form-input" id="admin-item-gst" type="number" min="0" max="40" required value="5">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="admin-item-sort">Sort order</label>
              <input class="form-input" id="admin-item-sort" type="number" min="0" value="0">
            </div>
            <div class="form-group" style="display:flex; gap:12px; align-items:center; padding-top:24px;">
              <label class="checkbox-row"><input type="checkbox" id="admin-item-veg"> Veg</label>
              <label class="checkbox-row"><input type="checkbox" id="admin-item-alcohol"> Alcohol</label>
            </div>
          </div>
          <button class="btn btn-primary btn-full" type="submit">Create item</button>
        </form>
      </div>
    </div>
  `;
}

function showFlowLogModal(entryId, events) {
  const existing = document.getElementById('flow-log-modal');
  if (existing) existing.remove();

  const typeLabels = {
    QUEUE_JOINED: 'Joined queue',
    PREORDER_CREATED: 'Pre-order created',
    PREORDER_REPLACED: 'Pre-order replaced',
    DEPOSIT_INITIATED: 'Deposit initiated',
    DEPOSIT_CAPTURED: 'Deposit captured',
    TABLE_NOTIFIED: 'Table ready notified',
    GUEST_SEATED: 'Guest seated',
    TABLE_ORDER_CREATED: 'Table order placed',
    FINAL_PAYMENT_INITIATED: 'Final payment initiated',
    FINAL_PAYMENT_CAPTURED: 'Final payment captured',
    OFFLINE_SETTLED: 'Settled offline',
    ENTRY_COMPLETED: 'Session completed',
    ENTRY_CANCELLED: 'Session cancelled',
    DEPOSIT_REFUNDED: 'Deposit refunded',
  };

  const isReconstructed = events.length > 0 && events[0].reconstructed;

  const rows = events.length
    ? events.map((ev) => {
        const snap = ev.snapshot || {};
        const details = Object.entries(snap)
          .filter(([k, v]) => v !== null && v !== undefined && k !== 'note')
          .map(([k, v]) => `<span class="mono">${escapeHtml(k)}</span>: ${typeof v === 'object' ? escapeHtml(JSON.stringify(v)) : escapeHtml(String(v))}`)
          .join(' · ');
        return `
          <div class="flow-event-row">
            <div class="flow-event-type">${escapeHtml(typeLabels[ev.type] || ev.type)}</div>
            <div class="flow-event-time">${new Date(ev.createdAt).toLocaleString()}</div>
            ${details ? `<div class="flow-event-snap">${details}</div>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="empty-state">No flow events recorded for this session yet.</div>';

  const modal = document.createElement('div');
  modal.id = 'flow-log-modal';
  modal.className = 'flow-log-overlay';
  modal.innerHTML = `
    <div class="flow-log-panel">
      <div class="flow-log-header">
        <div class="card-title">Order flow log</div>
        <div class="card-sub">Entry <span class="mono">${escapeHtml(entryId.slice(0, 8))}</span> · ${events.length} event${events.length === 1 ? '' : 's'}${isReconstructed ? ' · <em>Reconstructed from records</em>' : ''}</div>
        <button class="btn btn-secondary btn-sm flow-log-close" type="button">&times; Close</button>
      </div>
      <div class="flow-log-body">${rows}</div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.flow-log-close')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function renderShell({ pill, body, right = '' }) {
  return `
    <main class="app-shell">
      <header class="app-header">
        <div class="header-left">
          <div class="header-logo">fl<em>o</em>ck</div>
          <div class="header-pill">${escapeHtml(pill)}</div>
        </div>
        <div class="header-right">${right}</div>
      </header>
      <section class="app-body">${body}</section>
    </main>
  `;
}

function renderStepBar(activeStep) {
  const labels = ['Queue', 'Pre-order', 'Seated', 'Pay'];
  return `
    <div class="steps">
      ${labels.map((label, index) => {
        const stepNumber = index + 1;
        const className = activeStep > stepNumber ? 'done' : activeStep === stepNumber ? 'active' : '';
        return `
          <div class="step ${className}">
            <div class="step-dot">${stepNumber}</div>
            <div class="step-label">${label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getBucketItemCount(summary) {
  return (summary?.lines || []).reduce((sum, line) => sum + (line.quantity || 0), 0);
}

function renderGuestBottomNav(activeTray, itemCount) {
  return `
    <nav class="guest-bottom-nav" aria-label="Guest ordering trays">
      ${[
        ['menu', 'Menu'],
        ['bucket', 'Your Bucket'],
        ['ordered', 'Ordered'],
      ].map(([key, label]) => `
        <button class="guest-bottom-nav-btn ${activeTray === key ? 'active' : ''}" type="button" data-guest-tray="${key}">
          <span>${label}</span>
          ${key === 'bucket' && itemCount > 0 ? `<span class="guest-bottom-badge">${itemCount}</span>` : ''}
        </button>
      `).join('')}
    </nav>
  `;
}

function renderFloatingPayButton(balanceDue) {
  if (!balanceDue || balanceDue <= 0) {
    return '';
  }

  return `
    <div class="floating-pay-wrap">
      <button class="btn btn-primary btn-full floating-pay-btn" id="floating-final-pay-cta" type="button">
        Pay ${formatMoney(balanceDue)}
      </button>
    </div>
  `;
}

function renderGuestCategoryTabs(categories, activeCategoryId) {
  return `
    <div class="category-pills" data-category-tabs="guest">
      ${categories.map((category) => `
        <button
          class="category-pill ${activeCategoryId === category.id ? 'active' : ''}"
          type="button"
          data-category-jump="${category.id}">
          ${escapeHtml(category.name)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderBucketMenuSections(categories, cart) {
  return categories.map((category) => `
    <section id="guest-category-${category.id}" data-guest-category-section="${category.id}">
      <div class="cat-header">
        <div class="cat-header-name">${escapeHtml(category.name)}</div>
        <div class="cat-header-line"></div>
      </div>
      <div class="menu-grid">
        ${category.items.map((item) => {
          const qty = cart[item.id] || 0;
          const selected = qty > 0 ? 'selected' : '';
          return `
            <div class="menu-item ${selected}">
              <div class="menu-item-body">
                <div class="menu-item-name">${escapeHtml(item.name)}</div>
                <div class="menu-item-desc">${escapeHtml(item.description || 'No description')}</div>
                <div class="menu-item-price">${formatMoney(menuItemTotal(item))}</div>
              </div>
              <div class="menu-item-foot">
                <div class="qty-ctrl">
                  <button class="qty-btn" type="button" data-bucket-item data-item-id="${item.id}" data-delta="-1">−</button>
                  <span class="qty-num ${qty > 0 ? 'active' : ''}">${qty}</span>
                  <button class="qty-btn" type="button" data-bucket-item data-item-id="${item.id}" data-delta="1">+</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

function renderGuestMenuTray({ venue, draftCart }) {
  const categories = venue.menuCategories || [];
  const activeCategoryId = uiState.guestMenuActiveCategory || categories[0]?.id || null;

  return `
    <section class="guest-tray-panel" data-guest-tray-panel="menu">
      <div class="section-head">
        <div class="section-title">Menu</div>
        <div class="section-sub">Browse by category and build your next round. Nothing is sent until you confirm from Your Bucket.</div>
      </div>
      ${categories.length ? renderGuestCategoryTabs(categories, activeCategoryId) : ''}
      ${renderBucketMenuSections(categories, draftCart)}
    </section>
  `;
}

function renderGuestBucketTray({ draftSummary }) {
  return `
    <section class="guest-tray-panel" data-guest-tray-panel="bucket">
      <div class="section-head">
        <div class="section-title">Your Bucket</div>
        <div class="section-sub">This draft round is shared across the active table session until it is sent.</div>
      </div>
      <div class="card">
        ${uiState.partyBucket.lastSyncError ? `
          <div class="alert alert-amber" style="margin-bottom:16px;"><div>Sync delayed. Retrying in the background.</div></div>
        ` : ''}
        ${draftSummary.lines.length ? draftSummary.lines.map((line) => `
          <div class="order-line order-line-editable">
            <div>
              <div class="order-line-name">${escapeHtml(line.name)}</div>
              <div class="order-line-qty">${line.quantity} x ${formatMoney(line.unitTotal)}</div>
            </div>
            <div class="bucket-line-actions">
              <div class="qty-ctrl">
                <button class="qty-btn" type="button" data-bucket-line-item data-item-id="${line.id}" data-delta="-1" aria-label="${line.quantity > 1 ? 'Decrease quantity' : 'Remove item'}">-</button>
                <span class="qty-num ${line.quantity > 0 ? 'active' : ''}">${line.quantity}</span>
                <button class="qty-btn" type="button" data-bucket-line-item data-item-id="${line.id}" data-delta="1" aria-label="Increase quantity">+</button>
              </div>
              <div class="order-line-price">${formatMoney(line.total)}</div>
            </div>
          </div>
        `).join('') : '<div class="empty-state">Add items from Menu to build your next round.</div>'}
        <div class="order-total">
          <div class="order-total-label">Round total</div>
          <div class="order-total-val">${formatMoney(draftSummary.total)}</div>
        </div>
        <button class="btn btn-primary btn-full" id="submit-table-order" style="margin-top:16px;" ${draftSummary.lines.length ? '' : 'disabled'}>
          ${uiState.tableOrderSubmitting ? 'Sending order...' : 'Send order to table'}
        </button>
      </div>
    </section>
  `;
}

function renderGuestOrderedTray({ entry, bill }) {
  const preOrders = entry.orders.filter((order) => order.type === 'PRE_ORDER');
  const tableOrders = entry.orders.filter((order) => order.type === 'TABLE_ORDER');

  return `
    <section class="guest-tray-panel" data-guest-tray-panel="ordered">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Ordered so far</div>
          <div class="card-sub">Locked pre-orders and every submitted table round appear here.</div>
          ${preOrders.length ? preOrders.map((order) => renderGuestOrderBlock(order, 'Pre-order', 'Locked')).join('') : '<div class="empty-state">No pre-order items were locked before seating.</div>'}
          ${tableOrders.length ? tableOrders.map((order) => renderGuestOrderBlock(order, 'Table order')).join('') : '<div class="empty-state" style="margin-top:14px;">No add-on table orders yet.</div>'}
        </div>
        <div class="card">
          <div class="card-title">Bill</div>
          <div class="card-sub">Live bill for this table session.</div>
          ${bill ? `
            <div class="order-line"><div class="order-line-name">Subtotal</div><div class="order-line-price">${formatMoney(bill.summary.subtotalExGst)}</div></div>
            <div class="order-line"><div class="order-line-name">CGST</div><div class="order-line-price">${formatMoney(bill.summary.cgst)}</div></div>
            <div class="order-line"><div class="order-line-name">SGST</div><div class="order-line-price">${formatMoney(bill.summary.sgst)}</div></div>
            <div class="order-line"><div class="order-line-name">Deposit paid</div><div class="order-line-price">${formatMoney(bill.summary.depositPaid)}</div></div>
            <div class="order-total">
              <div class="order-total-label">Balance due</div>
              <div class="order-total-val">${formatMoney(bill.summary.balanceDue)}</div>
            </div>
            ${bill.summary.balanceDue > 0 ? `
              <button class="btn btn-primary btn-full" id="final-pay-cta" style="margin-top:16px;">${uiState.paymentSubmitting ? 'Preparing payment...' : 'Pay balance'}</button>
            ` : ''}
          ` : '<div class="empty-state">Bill data unavailable.</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderSeatedGuestShell({ entry, venue, bill, guestSession }) {
  const draftSummary = buildCartSummary(venue.menuCategories || [], BucketStore.getDraftCart());
  const bucketItemCount = getBucketItemCount(draftSummary);
  const participantCount = Math.max(
    1,
    Number(uiState.partySessionMeta?.participantCount || uiState.partyParticipants.length || 1),
  );
  return `
    <div class="guest-seated-shell">
      <div class="guest-shell-top card">
        <div class="guest-shell-eyebrow">Table ${entry.table?.label ? escapeHtml(entry.table.label) : 'assigned'}</div>
        <div class="guest-shell-title">Now seated</div>
        <div class="guest-shell-sub">Add to your next round from Menu, review live totals in Ordered, and only pay the remaining balance when ready.</div>
        <div class="guest-shell-meta">${participantCount} guest${participantCount === 1 ? '' : 's'} in this table session</div>
        ${entry.table?.section ? `<div class="guest-shell-meta">Section: ${escapeHtml(entry.table.section)}</div>` : ''}
        ${entry.displayRef ? `<div class="guest-shell-meta">Ref: <span class="mono">${escapeHtml(entry.displayRef)}</span></div>` : ''}
      </div>
      <div id="guest-tray-host"></div>
      <div id="guest-floating-pay-host">${renderFloatingPayButton(bill?.summary?.balanceDue || 0)}</div>
      <div id="guest-bucket-toast-host"></div>
      <div id="guest-bottom-nav-host">${renderGuestBottomNav(uiState.guestTray, bucketItemCount)}</div>
    </div>
  `;
}

function mountGuestCategoryTracking() {
  const sections = [...document.querySelectorAll('[data-guest-category-section]')];
  const buttons = [...document.querySelectorAll('[data-category-jump]')];
  if (!sections.length || !buttons.length || !window.IntersectionObserver) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;
    const activeId = visible.target.getAttribute('data-guest-category-section');
    uiState.guestMenuActiveCategory = activeId;
    buttons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-category-jump') === activeId);
    });
  }, {
    root: null,
    rootMargin: '-120px 0px -55% 0px',
    threshold: [0.2, 0.45, 0.75],
  });

  sections.forEach((section) => observer.observe(section));
}

function mountSeatedGuestExperience({ slug, entry, venue, bill, guestSession }) {
  const trayHost = document.getElementById('guest-tray-host');
  const navHost = document.getElementById('guest-bottom-nav-host');
  const payHost = document.getElementById('guest-floating-pay-host');
  const toastHost = document.getElementById('guest-bucket-toast-host');
  if (!trayHost || !navHost || !payHost) {
    return;
  }

  uiState.activeGuestView = {
    slug,
    entryId: entry.id,
    entry,
    venue,
    bill,
    guestSession,
    refreshSeatedShell: null,
  };

  const renderTrayShell = () => {
    const liveView = uiState.activeGuestView || {
      slug,
      entryId: entry.id,
      entry,
      venue,
      bill,
      guestSession,
      refreshSeatedShell: null,
    };
    const liveEntry = liveView.entry;
    const liveVenue = liveView.venue;
    const liveBill = liveView.bill;
    const liveGuestSession = liveView.guestSession;
    const draftCart = BucketStore.getDraftCart();
    const draftSummary = buildCartSummary(liveVenue.menuCategories || [], draftCart);
    const bucketCount = getBucketItemCount(draftSummary);

    uiState.activeGuestView = {
      ...liveView,
      refreshSeatedShell: renderTrayShell,
    };

    navHost.innerHTML = renderGuestBottomNav(uiState.guestTray, bucketCount);

    const showFloatingPay = uiState.guestTray !== 'ordered';
    payHost.innerHTML = showFloatingPay ? renderFloatingPayButton(liveBill?.summary?.balanceDue || 0) : '';

    if (toastHost) {
      const showToast = uiState.guestTray === 'menu' && bucketCount > 0;
      const prevKey = toastHost.dataset.toastKey || '';
      const nextKey = showToast ? `show:${bucketCount}` : 'hide';
      if (prevKey !== nextKey) {
        toastHost.dataset.toastKey = nextKey;
        toastHost.innerHTML = showToast ? `
          <div class="bucket-toast">
            <span class="bucket-toast-text">${bucketCount} item${bucketCount === 1 ? '' : 's'} in your bucket</span>
            <button class="btn btn-primary btn-sm bucket-toast-btn" type="button" data-toast-go-bucket>View Bucket</button>
          </div>
        ` : '';
        toastHost.querySelector('[data-toast-go-bucket]')?.addEventListener('click', () => {
          uiState.guestTray = 'bucket';
          uiState.guestTrayUserChosen = true;
          renderTrayShell();
        });
      }
    }

    if (uiState.guestTray === 'menu') {
      trayHost.innerHTML = renderGuestMenuTray({ venue: liveVenue, draftCart });

      trayHost.querySelectorAll('[data-bucket-item]').forEach((button) => {
        button.addEventListener('click', () => {
          const menuItemId = button.getAttribute('data-item-id');
          const delta = Number(button.getAttribute('data-delta'));
          if (uiState.activePartySessionId) {
            applyPartyBucketDelta(menuItemId, delta);
          } else {
            BucketStore.updateItem(liveEntry.id, menuItemId, delta);
            renderTrayShell();
          }
        });
      });

      trayHost.querySelectorAll('[data-category-jump]').forEach((button) => {
        button.addEventListener('click', () => {
          const categoryId = button.getAttribute('data-category-jump');
          uiState.guestMenuActiveCategory = categoryId;
          trayHost.querySelectorAll('[data-category-jump]').forEach((pill) => {
            pill.classList.toggle('active', pill.getAttribute('data-category-jump') === categoryId);
          });
          const target = document.getElementById(`guest-category-${categoryId}`);
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      mountGuestCategoryTracking();
    } else if (uiState.guestTray === 'bucket') {
      trayHost.innerHTML = renderGuestBucketTray({ draftSummary });

      trayHost.querySelectorAll('[data-bucket-line-item]').forEach((button) => {
        button.addEventListener('click', () => {
          const menuItemId = button.getAttribute('data-item-id');
          const delta = Number(button.getAttribute('data-delta'));
          if (uiState.activePartySessionId) {
            applyPartyBucketDelta(menuItemId, delta);
          } else {
            BucketStore.updateItem(liveEntry.id, menuItemId, delta);
            renderTrayShell();
          }
        });
      });

      trayHost.querySelector('#submit-table-order')?.addEventListener('click', async () => {
        if (uiState.tableOrderSubmitting) return;

        const activeGuestSession = getGuestSession(liveEntry.id);
        if (!activeGuestSession?.guestToken) {
          setFlash('amber', 'Re-enter OTP to continue ordering.');
          await renderGuestEntry(slug, liveEntry.id);
          return;
        }

        uiState.tableOrderSubmitting = true;
        renderTrayShell();

        try {
          const order = await apiRequest('/orders/table/guest', {
            method: 'POST',
            auth: 'guest',
            guestToken: activeGuestSession.guestToken,
            body: {
              queueEntryId: liveEntry.id,
              items: draftSummary.lines.map((line) => ({
                menuItemId: line.id,
                quantity: line.quantity,
              })),
            },
          });

          BucketStore.clearDraftCart();
          if (uiState.activePartySessionId) {
            try {
              await flushPartyBucketToServer({ force: true });
            } catch (_error) {
              setFlash('amber', 'Order was sent, but the shared bucket needs a refresh.');
              await refreshPartySessionState({ includeSummary: false, rerender: false });
            }
          }
          uiState.guestTray = 'ordered';
          uiState.guestTrayUserChosen = true;
          setFlash(
            order.posSync?.status === 'manual_fallback' ? 'amber' : 'green',
            order.posSync?.status === 'manual_fallback'
              ? 'Order recorded. Venue is using manual kitchen sync right now.'
              : 'Table order sent to the venue.'
          );
          await renderGuestEntry(slug, liveEntry.id);
        } catch (error) {
          setFlash('red', error.message);
          await renderGuestEntry(slug, liveEntry.id);
        } finally {
          uiState.tableOrderSubmitting = false;
        }
      });
    } else {
      trayHost.innerHTML = renderGuestOrderedTray({ entry: liveEntry, bill: liveBill });

      document.getElementById('final-pay-cta')?.addEventListener('click', async () => {
        if (uiState.paymentSubmitting) return;

        uiState.paymentSubmitting = true;
        renderTrayShell();

        try {
          await runHostedPayment({
            title: 'Flock final bill',
            initiatePath: '/payments/final/initiate',
            initiateBody: {
              venueId: liveVenue.id,
              queueEntryId: liveEntry.id,
            },
            capturePath: '/payments/final/capture',
            prefill: {
              name: liveEntry.guestName,
              contact: liveEntry.guestPhone,
            },
            auth: 'guest',
            guestToken: liveGuestSession.guestToken,
            apiRequest,
          });
          setFlash('green', 'Final payment captured.');
          await renderGuestEntry(slug, liveEntry.id);
        } catch (error) {
          setFlash('red', error.message);
          await renderGuestEntry(slug, liveEntry.id);
        } finally {
          uiState.paymentSubmitting = false;
        }
      });
    }

    navHost.querySelectorAll('[data-guest-tray]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextTray = button.getAttribute('data-guest-tray');
        if (nextTray === uiState.guestTray) return;
        uiState.guestTray = nextTray;
        uiState.guestTrayUserChosen = true;
        renderTrayShell();
      });
    });

    payHost.querySelector('#floating-final-pay-cta')?.addEventListener('click', async () => {
      if (uiState.paymentSubmitting) return;

      uiState.paymentSubmitting = true;
      renderTrayShell();

      try {
        await runHostedPayment({
          title: 'Flock final bill',
          initiatePath: '/payments/final/initiate',
          initiateBody: {
            venueId: liveVenue.id,
            queueEntryId: liveEntry.id,
          },
          capturePath: '/payments/final/capture',
          prefill: {
            name: liveEntry.guestName,
            contact: liveEntry.guestPhone,
          },
          auth: 'guest',
          guestToken: liveGuestSession.guestToken,
          apiRequest,
        });
        setFlash('green', 'Final payment captured.');
        await renderGuestEntry(slug, liveEntry.id);
      } catch (error) {
        setFlash('red', error.message);
        await renderGuestEntry(slug, liveEntry.id);
      } finally {
        uiState.paymentSubmitting = false;
      }
    });
  };

  renderTrayShell();
  startPartySessionPolling();
}

function renderSessionRef(entry) {
  if (!entry.displayRef) return '';
  return `<div class="session-ref">Session ref: <span class="mono">${escapeHtml(entry.displayRef)}</span></div>`;
}

function renderGuestStateHero(entry, guestSession) {
  const guestOtp = guestSession?.otp;

  if (entry.status === 'WAITING') {
    const pct = Math.max(10, Math.min(95, Math.round(100 - (entry.position * 8))));
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">${entry.position}</div>
        <div class="queue-pos-label">Queue position</div>
        <div class="queue-pos-sub">We will notify you when a matching table clears.</div>
        ${renderSessionRef(entry)}
      </div>
      <div class="wait-strip">
        <span class="wait-strip-ring" style="--pct:${pct}%"></span>
        <span class="wait-strip-val">${entry.estimatedWaitMin || 0}</span>
        <span class="wait-strip-unit">min wait</span>
      </div>
      <div class="otp-block">
        <div class="otp-num">${guestOtp ? escapeHtml(guestOtp) : 'Active'}</div>
        <div class="otp-label">${guestOtp ? 'Show this OTP when called' : 'Your seating code is active on this device'}</div>
      </div>
    `;
  }

  if (entry.status === 'NOTIFIED') {
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">${escapeHtml(entry.table?.label || 'Now')}</div>
        <div class="queue-pos-label">Table ready</div>
        <div class="queue-pos-sub">Head to the entrance and show the OTP to staff.</div>
        ${renderSessionRef(entry)}
      </div>
      <div class="otp-block">
        <div class="otp-num">${guestOtp ? escapeHtml(guestOtp) : 'Active'}</div>
        <div class="otp-label">${guestOtp ? 'Your reserved table is waiting' : 'Use your active seating code when you arrive'}</div>
      </div>
    `;
  }

  if (entry.status === 'SEATED') {
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">${escapeHtml(entry.table?.label || 'Seated')}</div>
        <div class="queue-pos-label">Now seated</div>
        <div class="queue-pos-sub">Your table is live. Add more items from your phone and clear the balance when ready.</div>
      </div>
    `;
  }

  if (entry.status === 'COMPLETED') {
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">Done</div>
        <div class="queue-pos-label">Service complete</div>
        <div class="queue-pos-sub">Payment is captured and the table can move into the next turn.</div>
        ${renderSessionRef(entry)}
      </div>
    `;
  }

  return `
    <div class="queue-hero">
      <div class="queue-pos-num">Closed</div>
      <div class="queue-pos-label">${escapeHtml(entry.status)}</div>
      <div class="queue-pos-sub">This queue entry is no longer active.</div>
    </div>
  `;
}

function renderGuestStateCards({ slug, entry, venue, bill, guestSession, tableCartSummary }) {
  const isPartyJoiner = Boolean(guestSession?.isPartyJoiner);

  if (entry.status === 'WAITING') {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Waiting state</div>
          <div class="card-sub">Phone number is the guest identity. The seating OTP is already active.</div>
          <div class="alert alert-blue"><div>WhatsApp and SMS notifications are sent through the backend notification layer.</div></div>
          ${entry.depositPaid > 0
            ? isPartyJoiner
              ? `<div class="alert alert-blue"><div>The host has already placed a pre-order (${formatMoney(entry.preOrderTotal || 0)}). You can add more items once seated.</div></div>`
              : `<div class="alert alert-green"><div>Deposit captured: ${formatMoney(entry.depositPaid)}. Pre-order total: ${formatMoney(entry.preOrderTotal || 0)}.</div></div>`
            : `<button class="btn btn-primary" id="preorder-cta">Pre-order now</button>`
          }
        </div>
        <div class="card">
          <div class="card-title">Venue</div>
          <div class="card-sub">${escapeHtml(venue.name)} · ${escapeHtml(venue.city)}</div>
          <div class="muted">Default deposit policy: ${venue.depositPercent}%</div>
          <div class="muted">Queue open: ${venue.isQueueOpen ? 'Yes' : 'No'}</div>
        </div>
      </div>
    `;
  }

  if (entry.status === 'NOTIFIED') {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Table ready</div>
          <div class="card-sub">${entry.table?.label ? `Reserved: ${escapeHtml(entry.table.label)}` : 'A matching table was reserved for you.'}</div>
          <div class="alert alert-green"><div>Arrive within the venue window and show the OTP to staff to avoid reassignment.</div></div>
          ${entry.depositPaid > 0
            ? isPartyJoiner
              ? `<div class="alert alert-blue"><div>The host locked a pre-order before seating. You'll be able to add items once seated.</div></div>`
              : `<div class="muted">Deposit secured: ${formatMoney(entry.depositPaid)}</div>`
            : '<button class="btn btn-primary" id="preorder-cta">Add a pre-order before seating</button>'
          }
        </div>
        <div class="card">
          <div class="card-title">Guest snapshot</div>
          <div class="muted">${entry.partySize} pax</div>
          <div class="muted">Phone: ${escapeHtml(entry.guestPhone)}</div>
          <div class="muted">Venue: ${escapeHtml(venue.name)}</div>
        </div>
      </div>
    `;
  }

  if (entry.status === 'SEATED' || entry.status === 'COMPLETED') {
    const preOrders = entry.orders.filter((order) => order.type === 'PRE_ORDER');
    const tableOrders = entry.orders.filter((order) => order.type === 'TABLE_ORDER');
    const canPlaceTableOrders = entry.status === 'SEATED' && Boolean(guestSession?.guestToken);
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Table ${entry.table?.label ? escapeHtml(entry.table.label) : 'assigned'}</div>
          <div class="card-sub">${entry.status === 'COMPLETED' ? 'Service is complete. Ordering is closed and the table can turn over cleanly.' : 'Pre-orders stay locked. Add more items from your phone while seated and settle only the balance due.'}</div>
          ${entry.table?.section ? `<div class="muted" style="margin-bottom:14px;">Section: ${escapeHtml(entry.table.section)}</div>` : ''}
          ${preOrders.length ? `
            <div class="alert alert-blue" style="margin-bottom:14px;"><div>Locked pre-order</div></div>
            ${preOrders.map((order) => renderGuestOrderBlock(order, 'Pre-order', 'Locked')).join('')}
          ` : '<div class="empty-state">No pre-order items were locked before seating.</div>'}
          ${tableOrders.length ? tableOrders.map((order) => `
            ${renderGuestOrderBlock(order, 'Table order')}
          `).join('') : '<div class="empty-state" style="margin-top:14px;">No add-on table orders yet.</div>'}

          ${entry.status === 'SEATED' ? `
            <div class="section-head" style="margin-top:18px;">
              <div class="section-title">Order at table</div>
              <div class="section-sub">The menu stays visible while seated. Pre-order items are already locked, any new rounds add to the live bill, and only the remaining balance is paid later.</div>
            </div>
            <div class="${canPlaceTableOrders ? '' : 'menu-locked'}">
              ${renderTableMenuSections(venue.menuCategories || [], getTableCart(entry.id), !canPlaceTableOrders)}
            </div>
            <div class="card" style="margin-top:16px; background:rgba(255,255,255,0.02);">
              <div class="card-title">${canPlaceTableOrders ? 'Current table-order cart' : 'Unlock ordering on this device'}</div>
              <div class="card-sub">${canPlaceTableOrders ? 'This cart is separate from the locked pre-order. Submit as many rounds as needed while seated.' : 'The menu remains visible, but this browser does not have the active guest session token. Enter the seating OTP once to unlock ordering in place.'}</div>
              ${canPlaceTableOrders ? `
                ${tableCartSummary.lines.length ? tableCartSummary.lines.map((line) => `
                  <div class="order-line">
                    <div>
                      <div class="order-line-name">${escapeHtml(line.name)}</div>
                      <div class="order-line-qty">${line.quantity} x ${formatMoney(line.unitTotal)}</div>
                    </div>
                    <div class="order-line-price">${formatMoney(line.total)}</div>
                  </div>
                `).join('') : '<div class="empty-state">Add items to build a table order.</div>'}
                <div class="order-total">
                  <div class="order-total-label">Round total</div>
                  <div class="order-total-val">${formatMoney(tableCartSummary.total)}</div>
                </div>
                <button class="btn btn-primary btn-full" id="submit-table-order" style="margin-top:16px;" ${tableCartSummary.lines.length ? '' : 'disabled'}>Submit order to table</button>
              ` : `
                <form id="recover-guest-session-form">
                  <div class="form-group">
                    <label class="form-label" for="guest-session-otp">Seating OTP</label>
                    <input class="form-input" id="guest-session-otp" required maxlength="6" placeholder="123456">
                  </div>
                  <button class="btn btn-secondary btn-full" type="submit">Restore ordering</button>
                </form>
              `}
            </div>
          ` : ''}
        </div>
        <div class="card">
          <div class="card-title">Bill</div>
          <div class="card-sub">Powered by <span class="mono">GET /orders/bill/:queueEntryId</span>.</div>
          ${bill ? `
            <div class="order-line"><div class="order-line-name">Subtotal</div><div class="order-line-price">${formatMoney(bill.summary.subtotalExGst)}</div></div>
            <div class="order-line"><div class="order-line-name">CGST</div><div class="order-line-price">${formatMoney(bill.summary.cgst)}</div></div>
            <div class="order-line"><div class="order-line-name">SGST</div><div class="order-line-price">${formatMoney(bill.summary.sgst)}</div></div>
            <div class="order-line"><div class="order-line-name">Deposit paid</div><div class="order-line-price">${formatMoney(bill.summary.depositPaid)}</div></div>
            <div class="order-total">
              <div class="order-total-label">Balance due</div>
              <div class="order-total-val">${formatMoney(bill.summary.balanceDue)}</div>
            </div>
            ${(entry.status === 'SEATED' && bill.summary.balanceDue > 0) ? `
              <button class="btn btn-primary btn-full" id="final-pay-cta" style="margin-top:16px;">Pay balance</button>
            ` : ''}
            ${(entry.status === 'COMPLETED') ? `
              <div class="alert alert-green" style="margin-top:16px;"><div>Final payment completed. The invoice generation path has already been triggered.</div></div>
              <div class="order-line" style="margin-top:10px;"><div class="order-line-name">Final amount settled</div><div class="order-line-price">${formatMoney(Math.max(0, ((bill.summary.totalIncGst || (bill.summary.subtotalExGst + bill.summary.cgst + bill.summary.sgst) || 0)) - (bill.summary.depositPaid || 0)))}</div></div>
              <button class="btn btn-secondary btn-full" id="guest-done-cta" style="margin-top:16px;">Done</button>
            ` : ''}
          ` : '<div class="empty-state">Bill data unavailable.</div>'}
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-title">Queue entry closed</div>
      <div class="card-sub">${entry.status === 'NO_SHOW' ? 'The reserved table timed out and the queue moved on.' : 'This guest entry is no longer available for actions.'}</div>
      <a class="btn btn-primary" data-nav href="/v/${slug}">Start a new queue entry</a>
    </div>
  `;
}

function renderGuestOrderBlock(order, label, tagLabel = '') {
  return `
    <div class="order-line" style="display:block; padding:14px 0;">
      <div style="display:flex; justify-content:space-between; gap:16px;">
        <div>
          <div class="order-line-name">${escapeHtml(label)}${tagLabel ? ` <span class="pre-tag">${escapeHtml(tagLabel)}</span>` : ''}</div>
          <div class="order-line-qty">${order.items.length} items · ${escapeHtml(order.status)}</div>
        </div>
        <div class="order-line-price">${formatMoney(order.totalIncGst || order.total || 0)}</div>
      </div>
      <div class="card-sub" style="margin-top:10px;">${renderGuestOrderItems(order.items)}</div>
    </div>
  `;
}

function renderGuestOrderItems(items) {
  return items.map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join(' · ');
}

function renderTableMenuSections(categories, cart, isLocked = false) {
  return categories.map((category) => `
    <section>
      <div class="cat-header">
        <div class="cat-header-name">${escapeHtml(category.name)}</div>
        <div class="cat-header-line"></div>
      </div>
      <div class="menu-grid">
        ${category.items.map((item) => {
          const qty = cart[item.id] || 0;
          const selected = qty > 0 ? 'selected' : '';
          return `
            <div class="menu-item ${selected} ${isLocked ? 'locked' : ''}">
              <div class="menu-item-body">
                <div class="menu-item-name">${escapeHtml(item.name)}</div>
                <div class="menu-item-desc">${escapeHtml(item.description || 'No description')}</div>
                <div class="menu-item-price">${formatMoney(menuItemTotal(item))}</div>
              </div>
              <div class="menu-item-foot">
                <div class="qty-ctrl">
                  <button class="qty-btn" type="button" data-table-cart-item data-item-id="${item.id}" data-delta="-1" ${isLocked ? 'disabled' : ''}>−</button>
                  <span class="qty-num ${qty > 0 ? 'active' : ''}">${qty}</span>
                  <button class="qty-btn" type="button" data-table-cart-item data-item-id="${item.id}" data-delta="1" ${isLocked ? 'disabled' : ''}>+</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

function renderMenuSections(categories, cart) {
  return categories.map((category) => `
    <section id="guest-category-${category.id}" data-guest-category-section="${category.id}">
      <div class="cat-header">
        <div class="cat-header-name">${escapeHtml(category.name)}</div>
        <div class="cat-header-line"></div>
      </div>
      <div class="menu-grid">
        ${category.items.map((item) => {
          const qty = cart[item.id] || 0;
          const selected = qty > 0 ? 'selected' : '';
          return `
            <div class="menu-item ${selected}">
              <div class="menu-item-body">
                <div class="menu-item-name">${escapeHtml(item.name)}</div>
                <div class="menu-item-desc">${escapeHtml(item.description || 'No description')}</div>
                <div class="menu-item-price">${formatMoney(menuItemTotal(item))}</div>
              </div>
              <div class="menu-item-foot">
                <div class="qty-ctrl">
                  <button class="qty-btn" type="button" data-cart-item data-item-id="${item.id}" data-delta="-1">−</button>
                  <span class="qty-num ${qty > 0 ? 'active' : ''}">${qty}</span>
                  <button class="qty-btn" type="button" data-cart-item data-item-id="${item.id}" data-delta="1">+</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

function renderTabButton(key, label, currentTab) {
  return `<button class="tab ${currentTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`;
}

function scrollActiveTabIntoView() {
  const activeTab = document.querySelector('.tabs .tab.active');
  if (activeTab) {
    activeTab.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
  }
}

function renderTableActions(table) {
  if (table.status === 'FREE') {
    return `
      <button class="btn btn-secondary btn-sm" data-table-id="${table.id}" data-table-status="OCCUPIED">Mark occupied</button>
      <button class="btn btn-secondary btn-sm" data-table-id="${table.id}" data-table-status="RESERVED">Reserve</button>
    `;
  }

  if (table.status === 'OCCUPIED') {
    return `<button class="btn btn-secondary btn-sm" data-table-id="${table.id}" data-table-status="CLEARING">Mark clearing</button>`;
  }

  if (table.status === 'CLEARING' || table.status === 'RESERVED') {
    return `<button class="btn btn-success btn-sm" data-table-id="${table.id}" data-table-status="FREE">Mark free</button>`;
  }

  return `<button class="btn btn-secondary btn-sm" data-table-id="${table.id}" data-table-status="FREE">Reset</button>`;
}

function renderInlineFlash(flash) {
  const className = flash.kind === 'green'
    ? 'alert-green'
    : flash.kind === 'red'
      ? 'alert-red'
      : flash.kind === 'blue'
        ? 'alert-blue'
        : 'alert-amber';

  return `<div class="alert ${className}"><div>${escapeHtml(flash.message)}</div></div>`;
}

async function apiRequest(path, options = {}) {
  const config = {
    method: options.method || 'GET',
    headers: {},
  };

  if (options.body !== undefined) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(options.body);
  }

  if (options.auth === 'guest') {
    if (!options.guestToken) {
      throw new Error('Guest session missing');
    }
    config.headers.Authorization = `Bearer ${options.guestToken}`;
  } else if (options.auth) {
    const auth = getStaffAuth();
    if (!auth?.token) {
      throw new Error('Unauthorized');
    }
    config.headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, config);
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { success: false, error: normaliseApiError(text, response.status) };
    }
  }

  if (!response.ok || payload.success === false) {
    throw new Error(normaliseApiError(payload.error, response.status));
  }

  return payload.data;
}

const BucketStore = {
  getDraftCart() {
    if (uiState.activePartySessionId) {
      return { ...uiState.partyBucket.cart };
    }
    const fallbackEntryId = uiState.activeGuestView?.entryId;
    return fallbackEntryId ? getTableCart(fallbackEntryId) : {};
  },
  setDraftCart(cart) {
    const nextCart = normaliseDraftCart(cart);
    if (uiState.activePartySessionId) {
      uiState.partyBucket.cart = nextCart;
      uiState.partyBucket.dirty = true;
      return;
    }
    const fallbackEntryId = uiState.activeGuestView?.entryId;
    if (fallbackEntryId) {
      setTableCart(fallbackEntryId, nextCart);
    }
  },
  applyDelta(menuItemId, delta) {
    const currentCart = BucketStore.getDraftCart();
    const current = currentCart[menuItemId] || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) {
      delete currentCart[menuItemId];
    } else {
      currentCart[menuItemId] = next;
    }
    BucketStore.setDraftCart(currentCart);
  },
  replaceFromServer(bucketItems) {
    uiState.partyBucket.serverItems = bucketItems || [];
    uiState.partyBucket.cart = normaliseDraftCart(bucketItemsToCart(bucketItems));
    uiState.partyBucket.lastSyncedAt = Date.now();
    uiState.partyBucket.lastSyncError = '';
    uiState.partyBucket.dirty = false;
  },
  clearDraftCart() {
    BucketStore.setDraftCart({});
  },
  getDraft(queueEntryId) {
    if (uiState.activePartySessionId) {
      return BucketStore.getDraftCart();
    }
    return getTableCart(queueEntryId);
  },
  setDraft(queueEntryId, cart) {
    if (uiState.activePartySessionId) {
      BucketStore.setDraftCart(cart);
      return;
    }
    setTableCart(queueEntryId, cart);
  },
  updateItem(queueEntryId, menuItemId, delta) {
    if (uiState.activePartySessionId) {
      BucketStore.applyDelta(menuItemId, delta);
      return;
    }
    updateTableCart(queueEntryId, menuItemId, delta);
  },
  clearDraft(queueEntryId) {
    if (uiState.activePartySessionId) {
      BucketStore.clearDraftCart();
      return;
    }
    setTableCart(queueEntryId, {});
  },
};

function rerenderActiveGuestShell() {
  uiState.activeGuestView?.refreshSeatedShell?.();
}

async function loadPartySessionState(entry, guestSession) {
  if (!entry?.partySession?.id || !guestSession?.guestToken) {
    console.warn('Party session unavailable for seated guest shell. Falling back to local bucket.');
    uiState.activePartySessionId = null;
    uiState.partySessionMeta = null;
    uiState.partyParticipants = [];
    resetPartyBucketState();
    return false;
  }

  uiState.partyBucket.isLoading = true;

  try {
    const sessionId = entry.partySession.id;
    const realtime = await apiRequest(`/party-sessions/${sessionId}/realtime`, {
      auth: 'guest',
      guestToken: guestSession.guestToken,
    });

    uiState.activePartySessionId = sessionId;
    uiState.partySessionMeta = realtime.session;
    uiState.partyParticipants = realtime.participants || [];
    BucketStore.replaceFromServer(realtime.bucket || []);
    if (uiState.activeGuestView?.bill && realtime.billSummary) {
      uiState.activeGuestView.bill.summary = realtime.billSummary;
    }
    uiState.partyPoll.failureCount = 0;
    uiState.partyPoll.nextDelayMs = uiState.partyPoll.baseDelayMs;
    uiState.partyPoll.lastError = '';
    return true;
  } catch (error) {
    console.warn('Failed to load party session state:', error);
    uiState.activePartySessionId = null;
    uiState.partySessionMeta = null;
    uiState.partyParticipants = [];
    resetPartyBucketState();
    uiState.partyPoll.failureCount += 1;
    uiState.partyPoll.lastError = error.message || 'Party session load failed.';
    return false;
  } finally {
    uiState.partyBucket.isLoading = false;
  }
}

async function refreshPartySessionState({ includeSummary = false, rerender = true } = {}) {
  const sessionId = uiState.activePartySessionId;
  const guestToken = uiState.activeGuestView?.guestSession?.guestToken;

  if (!sessionId || !guestToken) {
    return false;
  }

  try {
    const realtime = await apiRequest(`/party-sessions/${sessionId}/realtime`, {
      auth: 'guest',
      guestToken,
    });

    if (realtime.session) {
      uiState.partySessionMeta = realtime.session;
      if (uiState.activeGuestView?.entry) {
        uiState.activeGuestView.entry.status = realtime.session.queueStatus || uiState.activeGuestView.entry.status;
      }
    }
    uiState.partyParticipants = realtime.participants || [];

    if (!uiState.partyBucket.dirty && !uiState.partyBucket.isSyncing) {
      BucketStore.replaceFromServer(realtime.bucket || []);
    } else {
      uiState.partyBucket.serverItems = realtime.bucket || [];
      uiState.partyBucket.lastSyncedAt = Date.now();
    }

    if (uiState.activeGuestView?.bill && realtime.billSummary) {
      uiState.activeGuestView.bill.summary = realtime.billSummary;
    }

    uiState.partyPoll.failureCount = 0;
    uiState.partyPoll.nextDelayMs = uiState.partyPoll.baseDelayMs;
    uiState.partyPoll.lastError = '';

    if (rerender) {
      rerenderActiveGuestShell();
    }
    return true;
  } catch (error) {
    uiState.partyBucket.lastSyncError = error.message || 'Shared bucket refresh failed.';
    uiState.partyPoll.failureCount += 1;
    uiState.partyPoll.lastError = uiState.partyBucket.lastSyncError;
    uiState.partyPoll.nextDelayMs = computePartyPollBackoff(
      uiState.partyPoll.baseDelayMs,
      uiState.partyPoll.maxDelayMs,
      uiState.partyPoll.failureCount,
    );
    if (rerender) {
      rerenderActiveGuestShell();
    }
    return false;
  }
}

async function flushPartyBucketToServer(options = {}) {
  const sessionId = uiState.activePartySessionId;
  const guestToken = uiState.activeGuestView?.guestSession?.guestToken;
  const force = options.force === true;

  if (!sessionId || !guestToken) {
    return null;
  }

  if (!uiState.partyBucket.dirty && !force) {
    return uiState.partyBucket.serverItems;
  }

  if (uiState.partyBucket.isSyncing) {
    uiState.partyBucket.dirty = true;
    return null;
  }

  const outboundCart = { ...uiState.partyBucket.cart };
  const outboundSignature = serialiseDraftCart(outboundCart);
  uiState.partyBucket.isSyncing = true;

  try {
    const bucketItems = await apiRequest(`/party-sessions/${sessionId}/bucket`, {
      method: 'PUT',
      auth: 'guest',
      guestToken,
      body: {
        items: cartToBucketItems(outboundCart),
      },
    });

    const currentSignature = serialiseDraftCart(uiState.partyBucket.cart);
    uiState.partyBucket.lastSyncError = '';
    uiState.partyBucket.lastSyncedAt = Date.now();

    if (currentSignature === outboundSignature) {
      BucketStore.replaceFromServer(bucketItems);
    } else {
      uiState.partyBucket.serverItems = bucketItems;
      uiState.partyBucket.dirty = true;
    }

    return bucketItems;
  } catch (error) {
    uiState.partyBucket.lastSyncError = error.message || 'Shared bucket sync failed.';
    uiState.partyBucket.dirty = true;
    throw error;
  } finally {
    uiState.partyBucket.isSyncing = false;
    if (uiState.partyBucket.dirty) {
      schedulePartyBucketSync(true);
    }
    rerenderActiveGuestShell();
  }
}

function schedulePartyBucketSync(immediate = false) {
  if (!uiState.activePartySessionId) {
    return;
  }

  clearPartyBucketSyncTimer();
  uiState.partyBucket.pendingSyncTimer = window.setTimeout(() => {
    uiState.partyBucket.pendingSyncTimer = null;
    flushPartyBucketToServer().catch(() => {});
  }, immediate ? 0 : 350);
}

function applyPartyBucketDelta(menuItemId, delta) {
  BucketStore.applyDelta(menuItemId, delta);
  if (uiState.activePartySessionId) {
    schedulePartyBucketSync();
  }
  rerenderActiveGuestShell();
}

function startPartySessionPolling() {
  clearPartySessionPolling();
  uiState.partyPoll.nextDelayMs = uiState.partyPoll.baseDelayMs;

  const runTick = async () => {
    const pollSucceeded = await refreshPartySessionState({ includeSummary: false, rerender: true });
    if (uiState.activePartySessionId && uiState.activeGuestView?.entry?.status === 'SEATED') {
      const jitter = Math.floor(Math.random() * 450);
      uiState.partyPollerId = window.setTimeout(() => {
        runTick().catch(() => {});
      }, computeScheduledPartyPollDelay(uiState.partyPoll.nextDelayMs, document.hidden, jitter));
    }
    if (pollSucceeded && !document.hidden) {
      uiState.partyPoll.nextDelayMs = uiState.partyPoll.baseDelayMs;
    }
  };

  uiState.partyPollerId = window.setTimeout(() => {
    runTick().catch(() => {});
  }, uiState.partyPoll.baseDelayMs);
}

// Debug helper removed for production safety (was window.__flockJoinPartySession)

function isManagerRole(role) {
  return role === 'OWNER' || role === 'MANAGER';
}

function getSeatOtp() {
  return uiState.staffSeat.otpDigits.join('');
}

function setSeatOtpFromString(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6).split('');
  uiState.staffSeat.otpDigits = [0, 1, 2, 3, 4, 5].map((index) => digits[index] || '');
}

async function loadSeatedBills(seatedEntries) {
  const bills = await Promise.all(seatedEntries.map(async (entry) => {
    try {
      const bill = await apiRequest(`/orders/bill/${entry.id}`, { auth: true });
      return [entry.id, bill];
    } catch (_error) {
      return [entry.id, null];
    }
  }));
  return Object.fromEntries(bills);
}

function getSuggestedTableId(entry, tables) {
  const candidates = tables.filter((table) => (table.status === 'FREE' || table.status === 'RESERVED') && table.capacity >= entry.partySize);
  if (entry.table?.id && candidates.some((table) => table.id === entry.table.id)) {
    return entry.table.id;
  }
  return candidates.sort((a, b) => a.capacity - b.capacity)[0]?.id || '';
}

function resetStaffSeatState() {
  uiState.staffSeat = {
    otpDigits: ['', '', '', '', '', ''],
    tableId: '',
    prefilledFromQueueId: null,
    suggestedTableId: null,
    error: '',
    success: '',
    isSubmitting: false,
  };
}
