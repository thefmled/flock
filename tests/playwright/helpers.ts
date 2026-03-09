import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const fixtureConfig = {
  venueSlug: process.env.FLOCK_TEST_FIXTURE_VENUE_SLUG || 'the-barrel-room-koramangala',
  venueId: process.env.FLOCK_TEST_FIXTURE_VENUE_ID || '',
  staffPhone: process.env.FLOCK_TEST_STAFF_PHONE || '9000000002',
  adminPhone: process.env.FLOCK_TEST_ADMIN_PHONE || '9000000001',
  onboardingToken: process.env.FLOCK_TEST_ONBOARDING_TOKEN || '',
  runTag: process.env.FLOCK_TEST_RUN_TAG || 'playwright',
};

export function buildTestTag(runTag: string) {
  return `[FLOCK-TEST:${runTag}]`;
}

export function createGuestIdentity(runTag: string, label: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
  return {
    name: `${buildTestTag(runTag)} ${label}`,
    phone: `9${stamp}`,
  };
}

export function getEntryIdFromUrl(url: string) {
  const match = url.match(/\/e\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Could not extract queue entry id from URL: ${url}`);
  }
  return match[1];
}

export async function fetchVenue(request: APIRequestContext) {
  const response = await request.get(`/api/v1/venues/${fixtureConfig.venueSlug}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.data;
}

export async function resolveOtpFromAppState(page: Page, codeSelector: string) {
  const code = await page.locator(codeSelector).inputValue().catch(() => '');
  return code.trim();
}

export async function resolveOtpFromInternalState(request: APIRequestContext, phone: string, purpose: 'STAFF_LOGIN' | 'GUEST_QUEUE') {
  if (!fixtureConfig.onboardingToken) {
    return '';
  }

  const response = await request.get('/api/v1/internal/test-state', {
    params: { phone, purpose },
    headers: {
      'x-flock-onboarding-token': fixtureConfig.onboardingToken,
    },
  });

  if (!response.ok()) {
    return '';
  }

  const payload = await response.json();
  return payload.data?.latestOtp?.code || '';
}

async function loginOperator(page: Page, request: APIRequestContext, options: {
  route: '/staff/login' | '/admin/login';
  phone: string;
  sendFormSelector: '#staff-send-form' | '#admin-send-form';
  phoneSelector: '#staff-phone' | '#admin-phone';
  verifyFormSelector: '#staff-verify-form' | '#admin-verify-form';
  codeSelector: '#staff-code' | '#admin-code';
  postLoginPath: '/staff/dashboard' | '/admin/dashboard';
}) {
  const venue = await fetchVenue(request);

  await page.goto(options.route);
  await page.locator(options.phoneSelector).fill(options.phone);
  await page.locator(`${options.sendFormSelector} button[type="submit"]`).click();

  let code = await resolveOtpFromAppState(page, options.codeSelector);
  if (code.length !== 6) {
    code = await resolveOtpFromInternalState(request, options.phone, 'STAFF_LOGIN');
    if (code.length === 6) {
      await page.locator(options.codeSelector).fill(code);
    }
  }

  await expect(page.locator(options.codeSelector)).toHaveValue(/\d{6}/);
  await page.locator(`${options.verifyFormSelector} button[type="submit"]`).click();
  await page.waitForURL(new RegExp(`${options.postLoginPath.replace('/', '\\/')}$`), { timeout: 30_000 });

  return venue;
}

export async function loginStaff(page: Page, request: APIRequestContext) {
  return loginOperator(page, request, {
    route: '/staff/login',
    phone: fixtureConfig.staffPhone,
    sendFormSelector: '#staff-send-form',
    phoneSelector: '#staff-phone',
    verifyFormSelector: '#staff-verify-form',
    codeSelector: '#staff-code',
    postLoginPath: '/staff/dashboard',
  });
}

export async function loginAdmin(page: Page, request: APIRequestContext) {
  return loginOperator(page, request, {
    route: '/admin/login',
    phone: fixtureConfig.adminPhone,
    sendFormSelector: '#admin-send-form',
    phoneSelector: '#admin-phone',
    verifyFormSelector: '#admin-verify-form',
    codeSelector: '#admin-code',
    postLoginPath: '/admin/dashboard',
  });
}

export async function joinQueueAsGuest(page: Page, guest: { name: string; phone: string }) {
  await page.goto(`/v/${fixtureConfig.venueSlug}`);
  await page.locator('#guest-name').fill(guest.name);
  await page.locator('#guest-phone').fill(guest.phone);
  await page.locator('#party-size').fill('2');
  await page.locator('#join-form button[type="submit"]').click();
  await page.waitForURL(new RegExp(`/v/${fixtureConfig.venueSlug}/e/[^/]+$`), { timeout: 30_000 });
  return {
    entryId: getEntryIdFromUrl(page.url()),
  };
}

export async function startPreorder(page: Page) {
  await page.locator('#preorder-cta').click();
  await expect(page.locator('[data-submit-preorder]:visible')).toBeVisible();
}

export async function addItemsToPreorder(page: Page, count = 2) {
  await expect(page.locator('[data-cart-item][data-delta="1"]').first()).toBeVisible();
  for (let index = 0; index < count; index += 1) {
    await page.locator('[data-cart-item][data-delta="1"]').nth(index).click();
  }
}

export async function captureDeposit(page: Page) {
  await page.locator('[data-submit-preorder]:visible').click();
  await expect(page.locator('text=Deposit captured')).toBeVisible({ timeout: 30_000 });
}

export async function openShareSheet(page: Page) {
  await page.locator('#guest-invite-cta').click();
  await expect(page.locator('.share-link-preview')).toBeVisible();
  return (await page.locator('.share-link-preview').textContent())?.trim() || '';
}

export async function joinSharedSession(page: Page, shareLink: string, displayName: string) {
  await page.goto(shareLink);
  await page.locator('#join-display-name').fill(displayName);
  await page.locator('#join-party-session-submit').click();
  await page.waitForURL(new RegExp(`/v/${fixtureConfig.venueSlug}/e/[^/]+$`), { timeout: 30_000 });
}

export async function seatGuestFromDashboard(page: Page, guestPhone: string) {
  const row = page.locator('.q-row', { hasText: guestPhone }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Seat' }).click();
  await expect(page.locator('#seat-form')).toBeVisible();

  const seatTable = page.locator('#seat-table');
  if ((await seatTable.inputValue()) === '') {
    await seatTable.selectOption({ index: 1 });
  }

  await page.locator('#seat-form button[type="submit"]').click();
  await expect(page.locator('text=Guest seated.')).toBeVisible({ timeout: 30_000 });
}

export async function waitForSeatedGuest(page: Page) {
  await expect(page.locator('text=Table')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-guest-tray="bucket"]')).toBeVisible({ timeout: 30_000 });
}

export async function addSharedBucketItems(page: Page, count = 1) {
  await page.locator('[data-guest-tray="menu"]').click();
  for (let index = 0; index < count; index += 1) {
    await page.locator('[data-bucket-item][data-delta="1"]').nth(index).click();
  }
  await page.locator('[data-guest-tray="bucket"]').click();
}

export async function submitSharedBucket(page: Page) {
  await expect(page.locator('#submit-table-order')).toBeVisible();
  await page.locator('#submit-table-order').click();
}

export async function payFinalBill(page: Page) {
  const payButton = page.locator('#final-pay-cta, #floating-final-pay-cta').first();
  await expect(payButton).toBeVisible({ timeout: 30_000 });
  await payButton.click();
  await expect(page.locator('text=Final payment captured')).toBeVisible({ timeout: 30_000 });
}

export async function waitForHostedCheckout(page: Page) {
  await expect(page.locator('text=Test Mode')).toBeVisible({ timeout: 30_000 });
  const paymentFrame = page.frameLocator('iframe').first();
  await expect(paymentFrame.getByRole('heading', { name: 'UPI QR' })).toBeVisible({ timeout: 30_000 });
}

export async function dismissHostedCheckout(page: Page) {
  const paymentFrame = page.frameLocator('iframe').first();
  await paymentFrame.getByRole('button', { name: 'Close Checkout' }).click();
  await expect(page.locator('text=Test Mode')).toHaveCount(0, { timeout: 30_000 });
}

export async function getStaffToken(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('flock_staff_auth');
    return raw ? JSON.parse(raw).token : '';
  });
}

export async function getFlowEvents(request: APIRequestContext, token: string, entryId: string) {
  const response = await request.get(`/api/v1/queue/${entryId}/flow`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.data;
}

export async function openFlowLog(page: Page, entryText: string) {
  const row = page.locator('.q-row', { hasText: entryText }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Flow log' }).click();
  await expect(page.locator('#flow-log-modal')).toBeVisible();
}

export function attachRuntimeMonitors(page: Page) {
  const consoleErrors: string[] = [];
  const criticalFailures: Array<{ url: string; status: number }> = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/v1/')) {
      return;
    }

    const status = response.status();
    const criticalPath = [
      '/api/v1/tables',
      '/api/v1/menu/admin/current',
      '/api/v1/party-sessions/',
    ].some((fragment) => url.includes(fragment));

    if (criticalPath && status >= 400) {
      criticalFailures.push({ url, status });
    }
  });

  return {
    consoleErrors,
    criticalFailures,
  };
}
