import { chromium, request as playwrightRequest } from '@playwright/test';

const baseURL = process.env.FLOCK_TEST_URL || 'https://taurant.onrender.com';
const venueSlug = process.env.FLOCK_TEST_FIXTURE_VENUE_SLUG || 'the-barrel-room-koramangala';
const staffPhone = process.env.FLOCK_TEST_STAFF_PHONE || '9000000002';
const adminPhone = process.env.FLOCK_TEST_ADMIN_PHONE || '9000000001';
const onboardingToken = process.env.FLOCK_TEST_ONBOARDING_TOKEN || '';

const viewports = [
  { name: 'iPhone-14', width: 390, height: 844 },
  { name: 'Galaxy-S23', width: 412, height: 915 },
];

async function fetchOtp(api, phone) {
  if (!onboardingToken) {
    return '';
  }

  const response = await api.get('/api/v1/internal/test-state', {
    params: { phone, purpose: 'STAFF_LOGIN' },
    headers: { 'x-flock-onboarding-token': onboardingToken },
  });

  if (!response.ok()) {
    return '';
  }

  const payload = await response.json();
  return payload.data?.latestOtp?.code || '';
}

async function loginOperator(page, api, { route, phoneSelector, codeSelector, sendForm, verifyForm, phone }) {
  await page.goto(`${baseURL}${route}`, { waitUntil: 'networkidle' });
  await page.locator(phoneSelector).fill(phone);
  await page.locator(`${sendForm} button[type="submit"]`).click();

  let code = await page.locator(codeSelector).inputValue().catch(() => '');
  if (code.length !== 6) {
    code = await fetchOtp(api, phone);
    if (code.length === 6) {
      await page.locator(codeSelector).fill(code);
    }
  }

  await page.locator(`${verifyForm} button[type="submit"]`).click();
  await page.waitForLoadState('networkidle');
}

async function auditViewport(api, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const criticalFailures = [];

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
    const critical = [
      '/api/v1/tables',
      '/api/v1/menu/admin/current',
      '/api/v1/party-sessions/',
    ].some((fragment) => url.includes(fragment));

    if (critical && status >= 400) {
      criticalFailures.push({ url, status });
    }
  });

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.goto(`${baseURL}/v/${venueSlug}`, { waitUntil: 'networkidle' });
  await loginOperator(page, api, {
    route: '/staff/login',
    phoneSelector: '#staff-phone',
    codeSelector: '#staff-code',
    sendForm: '#staff-send-form',
    verifyForm: '#staff-verify-form',
    phone: staffPhone,
  });
  await page.reload({ waitUntil: 'networkidle' });

  await loginOperator(page, api, {
    route: '/admin/login',
    phoneSelector: '#admin-phone',
    codeSelector: '#admin-code',
    sendForm: '#admin-send-form',
    verifyForm: '#admin-verify-form',
    phone: adminPhone,
  });
  await page.reload({ waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));

  await context.close();
  await browser.close();

  return {
    viewport: viewport.name,
    overflow,
    consoleErrors,
    criticalFailures,
  };
}

async function main() {
  const api = await playwrightRequest.newContext({ baseURL });
  const results = [];

  for (const viewport of viewports) {
    results.push(await auditViewport(api, viewport));
  }

  await api.dispose();

  const hasCriticalFailures = results.some((result) => result.overflow || result.criticalFailures.length > 0);
  console.log(JSON.stringify({ baseURL, results }, null, 2));

  if (hasCriticalFailures) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
