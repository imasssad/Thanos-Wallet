import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: the Permissions view — connected dApps. No WC sessions exist
 * on a fresh wallet, so the "No connected apps" empty state renders.
 *
 * (Token allowances used to be a second tab; the scan only knew Makalu's
 * tokens and was removed with Makalu, 2026-09-29.) Live-network assertions
 * (real sessions) are out of scope for CI and covered by manual smoke
 * against staging.
 */

test.describe('Permissions', () => {
  test('opens the Permissions view from /app/permissions', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/permissions');
    await expect(page.getByText('Permissions', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Token allowances/i })).toHaveCount(0);
  });

  test('shows the empty state when no apps are connected', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/permissions');
    await expect(page.getByText(/No connected apps/i)).toBeVisible({ timeout: 15_000 });
  });
});
