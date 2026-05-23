import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: the Swap modal.
 *
 * The swap UI fetches quotes from MultX (cross-chain bridge) and Ignite
 * (same-chain DEX) in parallel and shows the user the better-of-two. In
 * CI neither backend is reachable, so the modal degrades to:
 *   - "Fetching quote…" briefly,
 *   - then an indicative rate from the local price table, with the
 *     Swap button surfaced as "Bridge offline".
 *
 * We assert against the degraded path (it's the deterministic one) and
 * leave the live-quote path to manual smoke testing against staging.
 */

test.describe('Swap', () => {
  test('opens the Swap modal with both token pickers + amount field', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Swap' }).first().click();

    // Modal title.
    await expect(page.getByText('Swap', { exact: true }).first()).toBeVisible();

    // From + To pickers have distinct aria-labels.
    const fromSel = page.getByRole('combobox', { name: /swap from/i }).first();
    const toSel   = page.getByRole('combobox', { name: /swap to/i }).first();
    await expect(fromSel).toBeVisible();
    await expect(toSel).toBeVisible();

    // Default pair LITHO → LitBTC.
    await expect(fromSel).toHaveText(/LITHO/);
    await expect(toSel).toHaveText(/LitBTC/);
  });

  test('rate line updates when the amount is entered', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Swap' }).first().click();

    // Default amount is 100; clear and re-enter to drive the rate-recompute.
    const amountField = page.locator('input[type="number"]').first();
    await amountField.fill('50');

    // The Rate row always renders (indicative or quoted). We don't pin the
    // exact number — just that the format "1 LITHO ≈ N LitBTC" appears.
    await expect(page.getByText(/1 LITHO ≈ .* LitBTC/)).toBeVisible({ timeout: 10_000 });
  });

  test('swap-direction button flips From and To', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Swap' }).first().click();

    const fromSel = page.getByRole('combobox', { name: /swap from/i }).first();
    const toSel   = page.getByRole('combobox', { name: /swap to/i }).first();

    // The ⇅ button has class `swap-btn` — single instance in the modal.
    await page.locator('.swap-btn').click();

    // Now LITHO and LitBTC are reversed.
    await expect(fromSel).toHaveText(/LitBTC/);
    await expect(toSel).toHaveText(/LITHO/);
  });

  test('Swap button is disabled when bridge + DEX are both offline', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Swap' }).first().click();

    // In CI both bridge.litho.ai and ignite.litho.ai are unreachable.
    // The modal eventually surfaces "Bridge offline" and disables the
    // primary action. Give it the full quote-debounce + timeout window.
    const swapBtn = page.getByRole('button', { name: /^(Swap |Bridge offline|Fetching quote)/ }).last();
    await expect(swapBtn).toBeVisible({ timeout: 15_000 });

    // It should NOT be enabled with both providers down. Either it's
    // "Fetching quote…" (still loading, disabled) or "Bridge offline"
    // (terminal, disabled). Both are valid; both must be disabled.
    await expect(swapBtn).toBeDisabled({ timeout: 30_000 });
  });
});
