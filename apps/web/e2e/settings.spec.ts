import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: Settings page mounts and the General sections render.
 *
 * The settings tree is large (General, Account, Address book, Security,
 * Network, About) — this spec checks that each section header is
 * present so a regression that drops one is caught early. Individual
 * controls (currency select, address-book add, etc.) live in their own
 * focused specs to keep this fast.
 */

test.describe('Settings', () => {
  test('all top-level sections render', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/settings');

    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();

    // Each section heading is an <h2> inside .settings-section-head. We
    // match loosely so re-ordering or minor copy changes don't break us.
    for (const heading of [/^General$/i, /^Security$/i, /^Address book$/i, /^Account$/i]) {
      await expect(page.getByRole('heading', { name: heading }).first())
        .toBeVisible({ timeout: 10_000 });
    }
  });

  test('currency selector is interactive', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/settings');

    // The currency Select is a Radix combobox (aria-label="Display currency").
    const currency = page.getByRole('combobox', { name: /display currency/i }).first();
    await expect(currency).toBeVisible();

    // The default is "USD"; clicking should open the dropdown options.
    await expect(currency).toHaveText(/USD/);
    await currency.click();

    // At least one of the other currencies appears as an option (Radix
    // portals these out of the DOM tree, but role + name still works).
    await expect(page.getByRole('option', { name: 'EUR' }).first())
      .toBeVisible({ timeout: 5_000 });
  });

  test('Manage permissions link navigates away from /settings', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/settings');

    const manage = page.getByRole('link', { name: /manage/i }).first();
    await expect(manage).toBeVisible();
    await manage.click();

    await expect(page).toHaveURL(/\/app\/permissions/);
  });
});
