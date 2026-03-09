import { test, expect } from '@playwright/test';
import {
  addItemsToPreorder,
  addSharedBucketItems,
  buildTestTag,
  createGuestIdentity,
  fixtureConfig,
  getEntryIdFromUrl,
  getFlowEvents,
  getStaffToken,
  joinQueueAsGuest,
  joinSharedSession,
  loginAdmin,
  loginStaff,
  openFlowLog,
  openShareSheet,
  payFinalBill,
  seatGuestFromDashboard,
  startPreorder,
  submitSharedBucket,
  waitForSeatedGuest,
} from './playwright/helpers';

test.describe.configure({ mode: 'serial' });

test('guest share flow, seated bucket sync, and final payment all work', async ({ browser, page, request }) => {
  const runTag = `${fixtureConfig.runTag}-guest-${Date.now()}`;
  const hostGuest = createGuestIdentity(runTag, 'Host');

  const companionContext = await browser.newContext();
  const companionPage = await companionContext.newPage();
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();

  await joinQueueAsGuest(page, hostGuest);
  await startPreorder(page);
  await addItemsToPreorder(page, 2);
  await page.locator('[data-submit-preorder]:visible').click();
  await expect(page.locator('text=Deposit captured')).toBeVisible({ timeout: 30_000 });

  const shareLink = await openShareSheet(page);
  expect(shareLink).toContain(`/v/${fixtureConfig.venueSlug}/session/`);

  await joinSharedSession(companionPage, shareLink, `${buildTestTag(runTag)} Companion`);

  await loginStaff(staffPage, request);
  await seatGuestFromDashboard(staffPage, hostGuest.phone);

  await page.reload();
  await companionPage.reload();
  await waitForSeatedGuest(page);
  await waitForSeatedGuest(companionPage);

  await addSharedBucketItems(companionPage, 1);
  await expect(page.locator('[data-guest-tray="bucket"]')).toBeVisible();
  await page.locator('[data-guest-tray="bucket"]').click();
  await expect(page.locator('#submit-table-order')).toBeVisible({ timeout: 30_000 });
  await submitSharedBucket(companionPage);

  await page.locator('[data-guest-tray="ordered"]').click();
  await expect(page.locator('text=Live bill')).toBeVisible({ timeout: 30_000 });

  await payFinalBill(page);
  await expect(page.locator('#guest-done-cta')).toBeVisible({ timeout: 30_000 });

  await staffContext.close();
  await companionContext.close();
});

test('staff manager controls and admin menu flows are operable end-to-end', async ({ browser, page, request }) => {
  const runTag = `${fixtureConfig.runTag}-ops-${Date.now()}`;
  const refundGuest = createGuestIdentity(runTag, 'Refund');
  const settleGuest = createGuestIdentity(runTag, 'Offline');
  const categoryName = `${buildTestTag(runTag)} Specials`;
  const itemName = `${buildTestTag(runTag)} Masala Peanuts`;

  const refundGuestPage = await browser.newPage();
  const settleGuestPage = await browser.newPage();
  const adminPage = await browser.newPage();

  await loginStaff(page, request);

  await joinQueueAsGuest(refundGuestPage, refundGuest);
  await startPreorder(refundGuestPage);
  await addItemsToPreorder(refundGuestPage, 1);
  await refundGuestPage.locator('[data-submit-preorder]:visible').click();
  await expect(refundGuestPage.locator('text=Deposit captured')).toBeVisible({ timeout: 30_000 });

  await openFlowLog(page, refundGuest.phone);
  const staffToken = await getStaffToken(page);
  const refundEntryId = getEntryIdFromUrl(refundGuestPage.url());
  const refundFlow = await getFlowEvents(request, staffToken, refundEntryId);
  const refundPaymentId = refundFlow.find((event) => event.paymentId)?.paymentId;
  expect(refundPaymentId).toBeTruthy();

  await page.locator('[data-tab="manager"]').click();
  await page.locator('#refund-payment-id').fill(refundPaymentId);
  await page.locator('#refund-form button[type="submit"]').click();
  await expect(page.locator('text=Refund request recorded.')).toBeVisible({ timeout: 30_000 });

  const refundRow = page.locator('.q-row', { hasText: refundGuest.phone }).first();
  if (await refundRow.isVisible()) {
    await refundRow.getByRole('button', { name: 'Cancel' }).click();
  }

  await joinQueueAsGuest(settleGuestPage, settleGuest);
  await seatGuestFromDashboard(page, settleGuest.phone);
  await settleGuestPage.reload();
  await waitForSeatedGuest(settleGuestPage);
  await addSharedBucketItems(settleGuestPage, 1);
  await submitSharedBucket(settleGuestPage);

  const settleEntryId = getEntryIdFromUrl(settleGuestPage.url());
  await page.locator('[data-tab="manager"]').click();
  await page.locator('#offline-queue-entry').fill(settleEntryId);
  await page.locator('#offline-settle-form button[type="submit"]').click();
  await expect(page.locator('text=Final bill marked as settled offline.')).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-tab="history"]').click();
  await expect(page.locator('.q-row', { hasText: settleGuest.phone }).first()).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-tab="tables"]').click();
  const freeButton = page.getByRole('button', { name: /Mark free|Reset/ }).first();
  if (await freeButton.isVisible()) {
    await freeButton.click();
  }

  await page.locator('[data-tab="manager"]').click();
  const originalDeposit = await page.locator('#manager-deposit').inputValue();
  const nextDeposit = originalDeposit === '75' ? '76' : '75';
  await page.locator('#manager-deposit').fill(nextDeposit);
  await page.locator('#manager-config-form button[type="submit"]').click();
  await expect(page.locator('text=Venue settings updated.')).toBeVisible({ timeout: 30_000 });
  const firstToggleLabel = await page.locator('#toggle-queue').textContent();
  await page.locator('#toggle-queue').click();
  await expect(page.locator(`text=${firstToggleLabel?.includes('Close') ? 'Queue closed.' : 'Queue opened.'}`)).toBeVisible({ timeout: 30_000 });
  const secondToggleLabel = await page.locator('#toggle-queue').textContent();
  await page.locator('#toggle-queue').click();
  await expect(page.locator(`text=${secondToggleLabel?.includes('Close') ? 'Queue closed.' : 'Queue opened.'}`)).toBeVisible({ timeout: 30_000 });

  await loginAdmin(adminPage, request);
  await adminPage.locator('[data-tab="add"]').click();
  await adminPage.locator('#admin-category-name').fill(categoryName);
  await adminPage.locator('#admin-category-form button[type="submit"]').click();
  await expect(adminPage.locator('text=Category created.')).toBeVisible({ timeout: 30_000 });
  await adminPage.locator('#admin-item-name').fill(itemName);
  await adminPage.locator('#admin-item-price').fill('125');
  await adminPage.locator('#admin-item-form button[type="submit"]').click();
  await expect(adminPage.locator('text=Menu item created.')).toBeVisible({ timeout: 30_000 });

  await adminPage.locator('[data-tab="menu"]').click();
  const menuRow = adminPage.locator('.q-row', { hasText: itemName }).first();
  await expect(menuRow).toBeVisible({ timeout: 30_000 });
  await menuRow.getByRole('button', { name: /Disable|Enable/ }).click();
  await expect(adminPage.locator('text=Menu item availability updated.')).toBeVisible({ timeout: 30_000 });
  await adminPage.locator('.q-row', { hasText: itemName }).first().getByRole('button', { name: 'Remove' }).click();
  await expect(adminPage.locator('text=Menu item removed.')).toBeVisible({ timeout: 30_000 });
});
