import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: the Swap modal.
 *
 * Same-chain swaps quoted (MultX / Ignite) and ran on the Makalu testnet's
 * token set, which the wallet no longer includes (2026-09-29). Until the DEX
 * quotes on Lithosphere Mainnet the modal says so instead of quoting — and
 * must not offer the old Makalu token pickers.
 */

test.describe('Swap', () => {
  test('Swap says it is coming soon and quotes nothing', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Swap' }).first().click();

    await expect(page.getByText('Swap is coming soon')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /swap from/i })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /swap to/i })).toHaveCount(0);
  });
});
