import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: every tab in the top nav mounts without throwing.
 *
 * Each tab corresponds to a top-level route under `/app`. We don't
 * exercise the page bodies in depth — the per-feature specs do — but
 * we *do* assert that clicking the tab actually navigates and that the
 * landing element of each page is visible. That catches "page returned
 * 500 / threw on mount" regressions before they hit users.
 */

test.describe('Navigation', () => {
  test('top-nav tabs reach the expected routes', async ({ page }) => {
    await createWallet(page);

    const targets: Array<{ tab: RegExp; urlContains: string; sentinel: RegExp }> = [
      { tab: /^Assets$/,   urlContains: '/app/assets',   sentinel: /assets|portfolio/i },
      { tab: /^Market$/,   urlContains: '/app/market',   sentinel: /market|price/i },
      { tab: /^Discover$/, urlContains: '/app/discover', sentinel: /discover|dapp|browser/i },
      { tab: /^Activity$/, urlContains: '/app/history',  sentinel: /activity|transaction|history/i },
      { tab: /^Earn$/,     urlContains: '/app/staking',  sentinel: /earn|stak/i },
    ];

    for (const t of targets) {
      await page.getByRole('button', { name: t.tab }).first().click();
      await expect(page).toHaveURL(new RegExp(t.urlContains.replace('/', '\\/')));
      await expect(page.getByText(t.sentinel).first()).toBeVisible({ timeout: 10_000 });
    }

    // Home brings us back to the dashboard.
    await page.getByRole('button', { name: /^Home$/ }).first().click();
    await expect(page).toHaveURL(/\/app\/?(\?|$)/);
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible();
  });

  test('account menu → Settings navigates to /app/settings', async ({ page }) => {
    await createWallet(page);

    await page.locator('.account-chip').click();
    await page.getByRole('button', { name: /^Settings$/ }).click();

    await expect(page).toHaveURL(/\/app\/settings/);
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('account menu → Permissions navigates to /app/permissions', async ({ page }) => {
    await createWallet(page);

    await page.locator('.account-chip').click();
    await page.getByRole('button', { name: /^Permissions$/ }).click();

    await expect(page).toHaveURL(/\/app\/permissions/);
  });
});
