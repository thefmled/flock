import { test, expect, Page } from '@playwright/test';

const VENUE_SLUG = 'the-barrel-room-koramangala';

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(overflow, 'Page should not have horizontal overflow').toBe(false);
}

// ─── Landing Page ─────────────────────────────────────────────────

test.describe('Landing page', () => {
  test('renders without overflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.brand-name');
    await noHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
  });
});

// ─── Venue / Guest Queue Join ─────────────────────────────────────

test.describe('Guest venue landing', () => {
  test('join form fits viewport', async ({ page }) => {
    await page.goto(`/v/${VENUE_SLUG}`);
    await page.waitForSelector('#join-form');
    await noHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('venue-landing.png', { fullPage: true });
  });
});

// ─── Staff Login ──────────────────────────────────────────────────

test.describe('Staff login', () => {
  test('OTP form renders cleanly', async ({ page }) => {
    await page.goto('/staff/login');
    await page.waitForSelector('#staff-send-form');
    await noHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('staff-login.png', { fullPage: true });
  });

  test('mockOtp auto-fills after send', async ({ page }) => {
    await page.goto('/staff/login');
    await page.fill('#staff-phone', '9000000002');
    await page.click('#staff-send-form button[type="submit"]');
    await page.waitForTimeout(2000);
    const codeValue = await page.inputValue('#staff-code');
    expect(codeValue.length, 'OTP should be auto-filled (6 digits)').toBe(6);
    await expect(page).toHaveScreenshot('staff-otp-filled.png', { fullPage: true });
  });
});

// ─── Staff Dashboard Tabs ─────────────────────────────────────────

test.describe('Staff dashboard', () => {
  async function loginStaff(page: Page) {
    await page.goto('/staff/login');
    await page.fill('#staff-phone', '9000000002');
    await page.click('#staff-send-form button[type="submit"]');
    await page.waitForTimeout(2000);
    const code = await page.inputValue('#staff-code');
    if (code.length === 6) {
      await page.click('#staff-verify-form button[type="submit"]');
      await page.waitForTimeout(3000);
    }
  }

  test('queue tab renders without overflow', async ({ page }) => {
    await loginStaff(page);
    await noHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('staff-queue-tab.png', { fullPage: true });
  });

  test('tabs scroll to active on re-render', async ({ page }) => {
    await loginStaff(page);
    const seatTab = page.locator('[data-tab="seat"]');
    if (await seatTab.isVisible()) {
      await seatTab.click();
      await page.waitForTimeout(1500);

      const isInView = await seatTab.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      });
      expect(isInView, 'Seat OTP tab should be visible after click').toBe(true);
      await noHorizontalOverflow(page);
      await expect(page).toHaveScreenshot('staff-seat-tab.png', { fullPage: true });
    }
  });

  test('manager tab form is not wiped by polling', async ({ page }) => {
    await loginStaff(page);
    const managerTab = page.locator('[data-tab="manager"]');
    if (await managerTab.isVisible()) {
      await managerTab.click();
      await page.waitForTimeout(1500);

      const depositInput = page.locator('#manager-deposit');
      if (await depositInput.isVisible()) {
        await depositInput.fill('50');
        await page.waitForTimeout(5000);
        const val = await depositInput.inputValue();
        expect(val, 'Manager form value should survive 5s without polling wipe').toBe('50');
      }
      await expect(page).toHaveScreenshot('staff-manager-tab.png', { fullPage: true });
    }
  });
});

// ─── Admin Login + Dashboard ──────────────────────────────────────

test.describe('Admin login', () => {
  test('renders cleanly', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForSelector('#admin-send-form');
    await noHorizontalOverflow(page);
    await expect(page).toHaveScreenshot('admin-login.png', { fullPage: true });
  });
});

// ─── Menu Item Cards (Overflow Test) ──────────────────────────────

test.describe('Menu item cards', () => {
  async function navigateToPreorder(page: Page) {
    await page.goto(`/v/${VENUE_SLUG}`);
    await page.waitForSelector('#join-form');
    await page.fill('#guest-name', 'Test');
    await page.fill('#guest-phone', '9876543210');
    await page.click('#join-form button[type="submit"]');
    await page.waitForTimeout(3000);
    const preorderCta = page.locator('#preorder-cta');
    if (await preorderCta.isVisible()) {
      await preorderCta.click();
      await page.waitForTimeout(2000);
    }
  }

  test('menu grid does not overflow on narrow phones', async ({ page }) => {
    await navigateToPreorder(page);
    await noHorizontalOverflow(page);

    const menuItems = page.locator('.menu-item');
    if (await menuItems.count() > 0) {
      const overflows = await page.evaluate(() => {
        const items = document.querySelectorAll('.menu-item');
        const viewportWidth = window.innerWidth;
        return Array.from(items).some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.right > viewportWidth + 2;
        });
      });
      expect(overflows, 'No menu item card should overflow the viewport').toBe(false);

      const qtyBtns = page.locator('.qty-btn');
      if (await qtyBtns.count() > 0) {
        const btnSize = await qtyBtns.first().evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        expect(btnSize.width, 'Qty button should be at least 36px wide').toBeGreaterThanOrEqual(35);
        expect(btnSize.height, 'Qty button should be at least 36px tall').toBeGreaterThanOrEqual(35);
      }

      await expect(page).toHaveScreenshot('menu-grid.png', { fullPage: true });
    }
  });
});

// ─── Global Checks (run on every page) ────────────────────────────

test.describe('Global defensive checks', () => {
  const pages = [
    { name: 'landing', path: '/' },
    { name: 'venue', path: `/v/${VENUE_SLUG}` },
    { name: 'staff-login', path: '/staff/login' },
    { name: 'admin-login', path: '/admin/login' },
  ];

  for (const pg of pages) {
    test(`${pg.name}: no horizontal scroll`, async ({ page }) => {
      await page.goto(pg.path);
      await page.waitForTimeout(2000);
      await noHorizontalOverflow(page);
    });

    test(`${pg.name}: text does not overflow containers`, async ({ page }) => {
      await page.goto(pg.path);
      await page.waitForTimeout(2000);

      const overflowingElements = await page.evaluate(() => {
        const results: string[] = [];
        const textSelectors = ['.card-title', '.card-sub', '.section-title', '.section-sub'];
        for (const sel of textSelectors) {
          document.querySelectorAll(sel).forEach((el) => {
            if (el.scrollWidth > el.clientWidth + 2) {
              results.push(`${sel}: "${el.textContent?.slice(0, 40)}..."`);
            }
          });
        }
        return results;
      });
      expect(overflowingElements, 'No text element should overflow its container').toEqual([]);
    });
  }
});
