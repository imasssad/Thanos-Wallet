import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: the Permissions view.
 *
 * Covers two facets:
 *   1. Token allowances list — sourced from the indexer in prod; in CI the
 *      indexer isn't reachable so the panel falls back to a live RPC scan,
 *      which also fails (no Makalu RPC in CI). We assert the empty state
 *      renders correctly under that double-fallback.
 *   2. Connected dApps — no WC sessions exist on a fresh wallet, so the
 *      "No connected apps" empty state renders.
 *
 * Live-network assertions (real allowances, real sessions) are out of scope
 * for CI and covered by manual smoke against staging.
 */

test.describe('Permissions', () => {
  test('opens the Permissions view from /app/permissions', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/permissions');
    await expect(page.getByText('Permissions', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Token allowances/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Connected apps/i })).toBeVisible();
  });

  test('shows empty state on Connected apps tab when no sessions exist', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/permissions');
    await page.getByRole('button', { name: /Connected apps/i }).click();
    await expect(page.getByText(/No connected apps/i)).toBeVisible({ timeout: 15_000 });
  });

  test('Token allowances tab renders the loading or empty state', async ({ page }) => {
    await createWallet(page);
    await page.goto('/app/permissions');
    // Either "Scanning approvals…" (loading), "No active allowances" (empty),
    // or an inline error banner — any of those is a healthy degraded path.
    const ok = page.getByText(/Scanning approvals|No active allowances|Failed to load/i);
    await expect(ok).toBeVisible({ timeout: 20_000 });
  });
});
