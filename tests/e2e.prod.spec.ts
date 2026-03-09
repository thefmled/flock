import { test, expect } from '@playwright/test';
import {
  addItemsToPreorder,
  attachRuntimeMonitors,
  createGuestIdentity,
  fixtureConfig,
  joinQueueAsGuest,
  loginAdmin,
  loginStaff,
  waitForHostedCheckout,
  startPreorder,
} from './playwright/helpers';

test.describe.configure({ mode: 'serial' });

function skipUnsupportedProdProjects(projectName: string) {
  return !['iPhone-14', 'Galaxy-S23'].includes(projectName);
}

test('production guest preorder reaches hosted checkout without critical failures', async ({ page, request }, testInfo) => {
  test.skip(skipUnsupportedProdProjects(testInfo.project.name), 'Production flow checks are pinned to the validated 390x844 and 412x915 widths.');

  const runTag = `${fixtureConfig.runTag}-prod-guest-${Date.now()}`;
  const hostGuest = createGuestIdentity(runTag, 'Host');

  const hostMonitors = attachRuntimeMonitors(page);

  await joinQueueAsGuest(page, hostGuest);
  await startPreorder(page);
  await addItemsToPreorder(page, 2);
  await page.locator('[data-submit-preorder]:visible').click();
  await waitForHostedCheckout(page);

  expect(hostMonitors.criticalFailures).toEqual([]);
  expect(hostMonitors.consoleErrors.filter((message) => /429|502|Something went wrong|Unhandled/i.test(message))).toEqual([]);
});

test('production staff and admin controls remain usable without critical 429/502 failures', async ({ browser, page, request }, testInfo) => {
  test.skip(skipUnsupportedProdProjects(testInfo.project.name), 'Production flow checks are pinned to the validated 390x844 and 412x915 widths.');

  const adminPage = await browser.newPage();

  const staffMonitors = attachRuntimeMonitors(page);
  const adminMonitors = attachRuntimeMonitors(adminPage);

  await loginStaff(page, request);
  await expect(page.getByRole('button', { name: 'Queue' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Tables' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Manager' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Tables' }).click();
  await page.getByRole('button', { name: 'Manager' }).click();

  await loginAdmin(adminPage, request);
  await expect(adminPage.locator('[data-tab="menu"]')).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.locator('[data-tab="add"]')).toBeVisible({ timeout: 30_000 });
  await adminPage.locator('[data-tab="menu"]').click();
  await adminPage.locator('[data-tab="add"]').click();

  expect(staffMonitors.criticalFailures).toEqual([]);
  expect(adminMonitors.criticalFailures).toEqual([]);
  expect([...staffMonitors.consoleErrors, ...adminMonitors.consoleErrors].filter((message) => /429|502|Something went wrong|Unhandled/i.test(message))).toEqual([]);

  await adminPage.close();
});
