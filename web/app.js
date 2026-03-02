const API_BASE = '/api/v1';
const DEFAULT_VENUE_SLUG = 'the-barrel-room-koramangala';
const STAFF_AUTH_KEY = 'flock_staff_auth';
const STAFF_PENDING_PHONE_KEY = 'flock_staff_pending_phone';
const ADMIN_PENDING_PHONE_KEY = 'flock_admin_pending_phone';
const GUEST_SESSION_PREFIX = 'flock_guest_session:';
const GUEST_ENTRY_PREFIX = 'flock_guest_entry:';
const PREORDER_CART_PREFIX = 'flock_cart:';
const TABLE_CART_PREFIX = 'flock_table_cart:';
const FLASH_KEY = 'flock_flash';

const appRoot = document.getElementById('app');
const uiState = {
  timerId: null,
  nextRenderResetScroll: false,
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

renderRoute().catch(handleFatalError);

function clearTimer() {
  if (uiState.timerId) {
    window.clearTimeout(uiState.timerId);
    uiState.timerId = null;
  }
}

function scheduleRefresh(fn, delayMs) {
  clearTimer();
  uiState.timerId = window.setTimeout(() => {
    fn().catch(handleBackgroundRefreshError);
  }, delayMs);
}

function navigate(path) {
  if (window.location.pathname === path) {
    renderRoute().catch(handleFatalError);
    return;
  }
  uiState.nextRenderResetScroll = true;
  history.pushState({}, '', path);
  renderRoute().catch(handleFatalError);
}

function renderPage(html, title = 'Flock') {
  clearTimer();
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

function handleFatalError(error) {
  const message = error instanceof Error ? error.message : 'Something broke';
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
  const message = error instanceof Error ? error.message : 'Background refresh failed';
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
  const segments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (segments.length === 0) {
    renderHome();
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments.length === 2) {
    await renderVenueLanding(segments[1]);
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments[2] === 'e' && segments[3] && segments.length === 4) {
    await renderGuestEntry(segments[1], segments[3]);
    return;
  }

  if (segments[0] === 'v' && segments[1] && segments[2] === 'e' && segments[3] && segments[4] === 'preorder') {
    await renderPreorder(segments[1], segments[3]);
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
        <div class="brand-name">Flock <em>v2</em></div>
        <div class="brand-tag">Queue · Pre-order · Seat · Pay</div>
      </div>
      <div class="role-cards">
        <a class="role-card" data-nav href="/v/${DEFAULT_VENUE_SLUG}">
          <span class="role-card-icon">G</span>
          <div class="role-card-title">Guest Flow</div>
          <div class="role-card-desc">Join the queue, pre-order, track the table-ready state, and complete the final payment.</div>
          <div class="role-card-cta">+</div>
        </a>
        <a class="role-card" data-nav href="/staff/login">
          <span class="role-card-icon">S</span>
          <div class="role-card-title">Staff Console</div>
          <div class="role-card-desc">Run live queue ops, free tables, verify OTPs, and manage the pilot venue in real time.</div>
          <div class="role-card-cta">+</div>
        </a>
        <a class="role-card" data-nav href="/admin/login">
          <span class="role-card-icon">A</span>
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
        <div class="brand-name">Flock <em>v2</em></div>
        <div class="brand-tag">${escapeHtml(venue.name)} · Queue &amp; Pre-order</div>
      </div>
      <div class="role-cards">
        <div class="role-card" style="cursor:default">
          <span class="role-card-icon">V</span>
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
      });
      setFlash('green', `Joined queue. OTP ${entry.otp} issued with position #${entry.position}.`);
      navigate(`/v/${slug}/e/${entry.id}`);
    } catch (error) {
      setFlash('red', error.message);
      await renderVenueLanding(slug);
    }
  });
}

async function renderGuestEntry(slug, entryId) {
  const [venue, entry] = await Promise.all([
    apiRequest(`/venues/${slug}`),
    apiRequest(`/queue/${entryId}`),
  ]);

  setGuestEntryId(slug, entryId);
  const flash = consumeFlash();
  const guestSession = getGuestSession(entryId);
  const tableCart = getTableCart(entryId);
  const tableCartSummary = buildCartSummary(venue.menuCategories || [], tableCart);
  const bill = entry.status === 'SEATED' || entry.status === 'COMPLETED'
    ? await apiRequest(`/orders/bill/${entryId}`).catch(() => null)
    : null;

  const hasDeposit = entry.depositPaid > 0;
  const activeStep = entry.status === 'COMPLETED'
    ? 5
    : entry.status === 'SEATED'
      ? 4
      : hasDeposit
        ? 2
        : 1;

  const body = `
    ${entry.status === 'NOTIFIED' ? `<div class="banner">Table ready${entry.table?.label ? ` · ${escapeHtml(entry.table.label)}` : ''} · Show your OTP to staff now</div>` : ''}
    ${renderStepBar(activeStep)}
    ${flash ? renderInlineFlash(flash) : ''}
    ${renderGuestStateHero(entry)}
    ${renderGuestStateCards({ slug, entry, venue, bill, guestSession, tableCartSummary })}
  `;

  renderPage(renderShell({
    pill: 'Guest',
    body,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/">Exit</a>`,
  }), `Flock | ${venue.name}`);

  document.getElementById('preorder-cta')?.addEventListener('click', () => {
    navigate(`/v/${slug}/e/${entryId}/preorder`);
  });

  document.getElementById('final-pay-cta')?.addEventListener('click', async () => {
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
      });
      setFlash('green', 'Final payment captured.');
      await renderGuestEntry(slug, entryId);
    } catch (error) {
      setFlash('red', error.message);
      await renderGuestEntry(slug, entryId);
    }
  });

  document.getElementById('guest-done-cta')?.addEventListener('click', () => {
    clearGuestSession(entryId);
    clearGuestEntryId(slug);
    setTableCart(entryId, {});
    navigate(`/v/${slug}`);
  });

  document.querySelectorAll('[data-table-cart-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const menuItemId = button.getAttribute('data-item-id');
      const delta = Number(button.getAttribute('data-delta'));
      updateTableCart(entryId, menuItemId, delta);
      renderGuestEntry(slug, entryId).catch(handleFatalError);
    });
  });

  document.getElementById('recover-guest-session-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
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
      });
      setFlash('green', 'Guest ordering session restored.');
      await renderGuestEntry(slug, entryId);
    } catch (error) {
      setFlash('red', error.message);
      await renderGuestEntry(slug, entryId);
    }
  });

  document.getElementById('submit-table-order')?.addEventListener('click', async () => {
    const activeGuestSession = getGuestSession(entryId);
    if (!activeGuestSession?.guestToken) {
      setFlash('amber', 'Re-enter OTP to continue ordering.');
      await renderGuestEntry(slug, entryId);
      return;
    }

    try {
      const order = await apiRequest('/orders/table/guest', {
        method: 'POST',
        auth: 'guest',
        guestToken: activeGuestSession.guestToken,
        body: {
          queueEntryId: entryId,
          items: tableCartSummary.lines.map((line) => ({
            menuItemId: line.id,
            quantity: line.quantity,
          })),
        },
      });

      setTableCart(entryId, {});
      setFlash(
        order.posSync?.status === 'manual_fallback'
          ? 'amber'
          : 'green',
        order.posSync?.status === 'manual_fallback'
          ? 'Order recorded. Venue is using manual kitchen sync right now.'
          : 'Table order sent to the venue.'
      );
      await renderGuestEntry(slug, entryId);
    } catch (error) {
      setFlash('red', error.message);
      await renderGuestEntry(slug, entryId);
    }
  });

  if (!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status)) {
    scheduleRefresh(() => renderGuestEntry(slug, entryId), 5000);
  }
}

async function renderPreorder(slug, entryId) {
  const [venue, entry] = await Promise.all([
    apiRequest(`/venues/${slug}`),
    apiRequest(`/queue/${entryId}`),
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
      <div class="section-head">
        <div class="section-title">Pre-order while waiting</div>
        <div class="section-sub">Menu and interaction patterns are ported directly from the Flock v2 design source.</div>
      </div>
      <div class="grid grid-2">
        <div>
          ${renderMenuSections(venue.menuCategories || [], cart)}
        </div>
        <div class="card">
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
            <button class="btn btn-primary" id="submit-preorder" ${cartSummary.lines.length ? '' : 'disabled'}>Pay deposit</button>
          </div>
        </div>
      </div>
    `,
    right: `<a class="btn btn-secondary btn-sm" data-nav href="/v/${slug}/e/${entryId}">Back</a>`,
  }), `Flock | Pre-order`);

  document.querySelectorAll('[data-cart-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const menuItemId = button.getAttribute('data-item-id');
      const delta = Number(button.getAttribute('data-delta'));
      updateCart(entryId, menuItemId, delta);
      renderPreorder(slug, entryId).catch(handleFatalError);
    });
  });

  document.getElementById('submit-preorder')?.addEventListener('click', async () => {
    try {
      const order = await apiRequest('/orders/preorder', {
        method: 'POST',
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
      });

      setCart(entryId, {});
      setFlash('green', 'Deposit captured. Your pre-order is now locked in.');
      navigate(`/v/${slug}/e/${entryId}`);
    } catch (error) {
      setFlash('red', error.message);
      await renderPreorder(slug, entryId);
    }
  });
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
      await apiRequest('/auth/staff/otp/send', {
        method: 'POST',
        body: { phone, venueId: venue.id },
      });
      sessionStorage.setItem(STAFF_PENDING_PHONE_KEY, phone);
      setFlash('green', 'OTP sent. Enter the code to access the console.');
      await renderStaffLogin();
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
      await apiRequest('/auth/staff/otp/send', {
        method: 'POST',
        body: { phone, venueId: venue.id },
      });
      sessionStorage.setItem(ADMIN_PENDING_PHONE_KEY, phone);
      setFlash('green', 'OTP sent. Admin access still requires a manager or owner role.');
      await renderAdminLogin();
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
  let venue;
  let queue;
  let tables;
  let stats;
  let recentTableEvents = [];

  try {
    [venue, queue, tables, stats, recentTableEvents] = await Promise.all([
      apiRequest(`/venues/${auth.venueSlug || DEFAULT_VENUE_SLUG}`),
      apiRequest('/queue/live', { auth: true }),
      apiRequest('/tables', { auth: true }),
      apiRequest('/venues/stats/today', { auth: true }),
      apiRequest('/tables/events/recent', { auth: true }).catch(() => []),
    ]);
  } catch (error) {
    if (/Unauthorized|expired/i.test(error.message)) {
      clearStaffAuth();
      navigate('/staff/login');
      return;
    }
    throw error;
  }

  const flash = consumeFlash();
  const waiting = queue.filter((entry) => entry.status === 'WAITING' || entry.status === 'NOTIFIED');
  const seated = queue.filter((entry) => entry.status === 'SEATED');
  const currentTab = uiState.staffTab;
  const seatedBills = await loadSeatedBills(seated);
  uiState.staffSeatedBills = seatedBills;
  uiState.staffLastUpdatedAt = Date.now();

  renderPage(renderShell({
    pill: 'Staff',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
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
        ${renderTabButton('tables', 'Tables', currentTab)}
        ${renderTabButton('seat', 'Seat OTP', currentTab)}
        ${renderTabButton('manager', 'Manager', currentTab)}
      </div>
      ${currentTab === 'queue' ? renderQueueTab(waiting, tables) : ''}
      ${currentTab === 'seated' ? renderSeatedTab(seated, seatedBills) : ''}
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
    button.addEventListener('click', async () => {
      try {
        await apiRequest(`/queue/${button.getAttribute('data-cancel-entry')}`, {
          method: 'DELETE',
          auth: true,
        });
        setFlash('green', 'Queue entry cancelled.');
        await renderStaffDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderStaffDashboard();
      }
    });
  });

  document.querySelectorAll('[data-table-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await apiRequest(`/tables/${button.getAttribute('data-table-id')}/status`, {
          method: 'PATCH',
          auth: true,
          body: { status: button.getAttribute('data-table-status') },
        });
        setFlash('green', 'Table status updated.');
        await renderStaffDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderStaffDashboard();
      }
    });
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

  document.getElementById('toggle-queue')?.addEventListener('click', async () => {
    try {
      await apiRequest('/venues/config', {
        method: 'PATCH',
        auth: true,
        body: { isQueueOpen: !venue.isQueueOpen },
      });
      setFlash('green', `Queue ${venue.isQueueOpen ? 'closed' : 'opened'}.`);
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  });

  document.getElementById('manager-config-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/venues/config', {
        method: 'PATCH',
        auth: true,
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
  });

  document.getElementById('offline-settle-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/payments/final/settle-offline', {
        method: 'POST',
        auth: true,
        body: { queueEntryId: document.getElementById('offline-queue-entry').value.trim() },
      });
      setFlash('green', 'Final bill marked as settled offline.');
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  });

  document.getElementById('refund-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/payments/refund', {
        method: 'POST',
        auth: true,
        body: {
          paymentId: document.getElementById('refund-payment-id').value.trim(),
        },
      });
      setFlash('green', 'Refund request recorded.');
      await renderStaffDashboard();
    } catch (error) {
      setFlash('red', error.message);
      await renderStaffDashboard();
    }
  });

  if (currentTab !== 'seat' && !uiState.staffSeat.isSubmitting) {
    scheduleRefresh(() => renderStaffDashboard(), 3000);
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

  let venue;
  let menu;

  try {
    [venue, menu] = await Promise.all([
      apiRequest(`/venues/${auth.venueSlug || DEFAULT_VENUE_SLUG}`),
      apiRequest('/menu/admin/current', { auth: true }),
    ]);
  } catch (error) {
    if (/Unauthorized|expired/i.test(error.message)) {
      clearStaffAuth();
      navigate('/admin/login');
      return;
    }
    throw error;
  }

  const flash = consumeFlash();
  uiState.adminMenu.categories = menu.categories || [];

  renderPage(renderShell({
    pill: 'Admin',
    body: `
      ${flash ? renderInlineFlash(flash) : ''}
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

  document.getElementById('admin-logout')?.addEventListener('click', () => {
    clearStaffAuth();
    navigate('/admin/login');
  });

  document.querySelectorAll('[data-admin-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await apiRequest(`/menu/items/${button.getAttribute('data-admin-toggle')}/toggle`, {
          method: 'PATCH',
          auth: true,
        });
        setFlash('green', 'Menu item availability updated.');
        await renderAdminDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderAdminDashboard();
      }
    });
  });

  document.querySelectorAll('[data-admin-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await apiRequest(`/menu/items/${button.getAttribute('data-admin-remove')}`, {
          method: 'DELETE',
          auth: true,
        });
        setFlash('green', 'Menu item removed.');
        await renderAdminDashboard();
      } catch (error) {
        setFlash('red', error.message);
        await renderAdminDashboard();
      }
    });
  });

  document.getElementById('admin-category-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/menu/categories', {
        method: 'POST',
        auth: true,
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
  });

  document.getElementById('admin-item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/menu/items', {
        method: 'POST',
        auth: true,
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
  });
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
        <div class="q-row-meta">${escapeHtml(entry.guestPhone)} · ${entry.partySize} pax · OTP <span class="mono">${escapeHtml(entry.otp)}</span></div>
        <div class="q-row-orders">
          ${entry.estimatedWaitMin ? `ETA ~${entry.estimatedWaitMin} mins` : 'Awaiting table match'}
          ${entry.table?.label ? ` · Reserved ${escapeHtml(entry.table.label)}` : ''}
        </div>
        ${entry.orders?.length ? `<div class="q-row-orders">Pre-order: ${escapeHtml(renderGuestOrderItems(entry.orders.flatMap((order) => order.items || [])) || 'Locked items on file')}</div>` : ''}
      </div>
      <div class="q-row-actions">
        <button class="btn btn-secondary btn-sm" data-prefill-seat="${escapeHtml(entry.otp)}" data-entry-id="${entry.id}" data-suggested-table="${getSuggestedTableId(entry, tables)}">Seat</button>
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
          <div class="q-row-meta">${escapeHtml(entry.guestPhone)} · ${entry.partySize} pax${entry.table?.section ? ` · ${escapeHtml(entry.table.section)}` : ''}</div>
          <div class="q-row-orders">${entry.orders?.length ? renderGuestOrderItems(entry.orders.flatMap((order) => order.items || [])) : 'No orders posted yet.'}</div>
        </div>
        <div class="q-row-actions" style="align-items:flex-end;">
          <div class="muted">${bill ? `Total ${formatMoney(bill.summary.totalIncGst)}` : 'Loading bill'}</div>
          ${bill ? `<div class="muted">Balance ${formatMoney(bill.summary.balanceDue)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state">No seated parties are active right now.</div>';
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

function renderShell({ pill, body, right = '' }) {
  return `
    <main class="app-shell">
      <header class="app-header">
        <div class="header-left">
          <div class="header-logo">Flock <em>v2</em></div>
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

function renderGuestStateHero(entry) {
  if (entry.status === 'WAITING') {
    const pct = Math.max(10, Math.min(95, Math.round(100 - (entry.position * 8))));
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">${entry.position}</div>
        <div class="queue-pos-label">Queue position</div>
        <div class="queue-pos-sub">We will notify you when a matching table clears.</div>
      </div>
      <div class="wait-estimate">
        <div class="wait-icon">ETA</div>
        <div class="wait-text">
          <div class="wait-label">Estimated wait</div>
          <div class="wait-value">${entry.estimatedWaitMin || 0}<span>mins</span></div>
        </div>
        <div class="progress-ring" style="--pct:${pct}%"></div>
      </div>
      <div class="otp-block">
        <div class="otp-num">${escapeHtml(entry.otp)}</div>
        <div class="otp-label">Show this OTP when called</div>
      </div>
    `;
  }

  if (entry.status === 'NOTIFIED') {
    return `
      <div class="queue-hero">
        <div class="queue-pos-num">${escapeHtml(entry.table?.label || 'Now')}</div>
        <div class="queue-pos-label">Table ready</div>
        <div class="queue-pos-sub">Head to the entrance and show the OTP to staff.</div>
      </div>
      <div class="otp-block">
        <div class="otp-num">${escapeHtml(entry.otp)}</div>
        <div class="otp-label">Your reserved table is waiting</div>
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
  if (entry.status === 'WAITING') {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Waiting state</div>
          <div class="card-sub">Phone number is the guest identity. The seating OTP is already active.</div>
          <div class="alert alert-blue"><div>WhatsApp and SMS notifications are sent through the backend notification layer.</div></div>
          ${entry.depositPaid > 0 ? `
            <div class="alert alert-green"><div>Deposit captured: ${formatMoney(entry.depositPaid)}. Pre-order total: ${formatMoney(entry.preOrderTotal || 0)}.</div></div>
          ` : `
            <button class="btn btn-primary" id="preorder-cta">Pre-order now</button>
          `}
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
          ${entry.depositPaid > 0 ? `<div class="muted">Deposit secured: ${formatMoney(entry.depositPaid)}</div>` : '<button class="btn btn-primary" id="preorder-cta">Add a pre-order before seating</button>'}
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
              <div class="menu-item-name">${escapeHtml(item.name)}</div>
              <div class="menu-item-desc">${escapeHtml(item.description || 'No description')}</div>
              <div class="menu-item-foot">
                <div class="menu-item-price">${formatMoney(menuItemTotal(item))}</div>
                <div class="qty-ctrl">
                  <button class="qty-btn" type="button" data-table-cart-item data-item-id="${item.id}" data-delta="-1" ${isLocked ? 'disabled' : ''}>-</button>
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
            <div class="menu-item ${selected}">
              <div class="menu-item-name">${escapeHtml(item.name)}</div>
              <div class="menu-item-desc">${escapeHtml(item.description || 'No description')}</div>
              <div class="menu-item-foot">
                <div class="menu-item-price">${formatMoney(menuItemTotal(item))}</div>
                <div class="qty-ctrl">
                  <button class="qty-btn" type="button" data-cart-item data-item-id="${item.id}" data-delta="-1">-</button>
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

function renderStatusBadge(status) {
  if (status === 'WAITING') return '<span class="badge badge-waiting">Waiting</span>';
  if (status === 'NOTIFIED') return '<span class="badge badge-ready">Notified</span>';
  if (status === 'SEATED') return '<span class="badge badge-seated">Seated</span>';
  return `<span class="badge badge-neutral">${escapeHtml(status)}</span>`;
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

function buildCartSummary(categories, cart) {
  const itemsById = new Map();
  categories.forEach((category) => {
    category.items.forEach((item) => itemsById.set(item.id, item));
  });

  const lines = Object.entries(cart)
    .filter(([id, quantity]) => quantity > 0 && itemsById.has(id))
    .map(([id, quantity]) => {
      const item = itemsById.get(id);
      return {
        id,
        name: item.name,
        quantity,
        unitTotal: menuItemTotal(item),
        total: menuItemTotal(item) * quantity,
      };
    });

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.total, 0),
  };
}

async function runHostedPayment({ title, initiatePath, initiateBody, capturePath, prefill }) {
  const initiation = await apiRequest(initiatePath, {
    method: 'POST',
    body: initiateBody,
  });

  if (initiation.keyId === 'mock_key') {
    await apiRequest(capturePath, {
      method: 'POST',
      body: {
        razorpayOrderId: initiation.razorpayOrderId,
        razorpayPaymentId: `pay_mock_${Date.now()}`,
        razorpaySignature: 'mock_signature',
      },
    });
    return;
  }

  if (!window.Razorpay) {
    throw new Error('Razorpay checkout failed to load. Please refresh and retry.');
  }

  await new Promise((resolve, reject) => {
    const razorpay = new window.Razorpay({
      key: initiation.keyId,
      amount: initiation.amount,
      currency: initiation.currency,
      name: 'Flock',
      description: title,
      order_id: initiation.razorpayOrderId,
      prefill: {
        name: prefill?.name || '',
        contact: prefill?.contact || '',
      },
      theme: { color: '#e8a830' },
      handler: async (response) => {
        try {
          await apiRequest(capturePath, {
            method: 'POST',
            body: {
              razorpayOrderId: response.razorpay_order_id || initiation.razorpayOrderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled before completion.')),
      },
    });
    razorpay.open();
  });
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

function normaliseApiError(rawError, status) {
  const fallback = status >= 500
    ? 'The service is temporarily unavailable. Please retry in a few seconds.'
    : `Request failed (${status})`;

  if (!rawError) {
    return fallback;
  }

  const errorText = String(rawError).trim();
  const looksLikeHtml = errorText.startsWith('<!DOCTYPE') || errorText.startsWith('<html');

  if (looksLikeHtml) {
    if (status === 502 || status === 503 || status === 504) {
      return 'The hosted app is waking up or temporarily unavailable. Please retry in a few seconds.';
    }
    return fallback;
  }

  if (status === 502 || status === 503 || status === 504) {
    return 'The hosted app is temporarily unavailable. Please retry in a few seconds.';
  }

  return errorText;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100);
}

function menuItemTotal(item) {
  const base = item.priceExGst || 0;
  const total = base + Math.round(base * ((item.gstPercent || 0) / 100));
  return total;
}

function normalisePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.slice(-10);
}

function getGuestEntryId(slug) {
  return localStorage.getItem(`${GUEST_ENTRY_PREFIX}${slug}`);
}

function setGuestEntryId(slug, entryId) {
  localStorage.setItem(`${GUEST_ENTRY_PREFIX}${slug}`, entryId);
}

function clearGuestEntryId(slug) {
  localStorage.removeItem(`${GUEST_ENTRY_PREFIX}${slug}`);
}

function getGuestSession(entryId) {
  try {
    return JSON.parse(localStorage.getItem(`${GUEST_SESSION_PREFIX}${entryId}`) || 'null');
  } catch (_error) {
    return null;
  }
}

function setGuestSession(session) {
  localStorage.setItem(`${GUEST_SESSION_PREFIX}${session.entryId}`, JSON.stringify(session));
}

function clearGuestSession(entryId) {
  localStorage.removeItem(`${GUEST_SESSION_PREFIX}${entryId}`);
}

function getStaffAuth() {
  try {
    return JSON.parse(localStorage.getItem(STAFF_AUTH_KEY) || 'null');
  } catch (_error) {
    return null;
  }
}

function clearStaffAuth() {
  localStorage.removeItem(STAFF_AUTH_KEY);
}

function setFlash(kind, message) {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ kind, message }));
}

function consumeFlash() {
  const raw = sessionStorage.getItem(FLASH_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(FLASH_KEY);
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function getCart(entryId) {
  try {
    return JSON.parse(localStorage.getItem(`${PREORDER_CART_PREFIX}${entryId}`) || '{}');
  } catch (_error) {
    return {};
  }
}

function setCart(entryId, cart) {
  localStorage.setItem(`${PREORDER_CART_PREFIX}${entryId}`, JSON.stringify(cart));
}

function updateCart(entryId, menuItemId, delta) {
  const cart = getCart(entryId);
  const current = cart[menuItemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    delete cart[menuItemId];
  } else {
    cart[menuItemId] = next;
  }
  setCart(entryId, cart);
}

function getTableCart(entryId) {
  try {
    return JSON.parse(localStorage.getItem(`${TABLE_CART_PREFIX}${entryId}`) || '{}');
  } catch (_error) {
    return {};
  }
}

function setTableCart(entryId, cart) {
  localStorage.setItem(`${TABLE_CART_PREFIX}${entryId}`, JSON.stringify(cart));
}

function updateTableCart(entryId, menuItemId, delta) {
  const cart = getTableCart(entryId);
  const current = cart[menuItemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    delete cart[menuItemId];
  } else {
    cart[menuItemId] = next;
  }
  setTableCart(entryId, cart);
}

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
      const bill = await apiRequest(`/orders/bill/${entry.id}`);
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

function formatRelativeStamp(timestamp) {
  if (!timestamp) return 'just now';
  const diffMs = Math.max(0, Date.now() - Number(timestamp));
  const diffSeconds = Math.round(diffMs / 1000);
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
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
