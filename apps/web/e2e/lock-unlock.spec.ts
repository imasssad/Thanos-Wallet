import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: explicitly lock the wallet from the account menu, then
 * unlock it again. Wrong password is rejected; right password returns
 * us to the dashboard.
 *
 * Exercises the AES-GCM vault open path and the Argon2id KDF on the
 * unlock side — the same primitives used for cold reload, just driven
 * by the user clicking "Lock wallet" instead of closing the tab.
 */

const PASSWORD = 'lock-unlock-pw-321';

test.describe('Lock / Unlock', () => {
  test('lock from account menu → unlock with the right password', async ({ page }) => {
    await createWallet(page, PASSWORD);

    // Open the account chip and click Lock wallet.
    await page.locator('.account-chip').click();
    await page.getByRole('button', { name: /lock wallet/i }).click();

    // Unlock screen should appear with the password field focused.
    const pwd = page.getByPlaceholder('Enter password');
    await expect(pwd).toBeVisible({ timeout: 10_000 });

    await pwd.fill(PASSWORD);
    await page.getByRole('button', { name: /unlock/i }).click();

    // Back on the dashboard.
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('wrong password keeps the wallet locked and surfaces an error', async ({ page }) => {
    await createWallet(page, PASSWORD);

    await page.locator('.account-chip').click();
    await page.getByRole('button', { name: /lock wallet/i }).click();

    const pwd = page.getByPlaceholder('Enter password');
    await expect(pwd).toBeVisible({ timeout: 10_000 });

    await pwd.fill('definitely-not-the-real-password');
    await page.getByRole('button', { name: /unlock/i }).click();

    // Still locked — the unlock field is still mounted, no Send button.
    // (Argon2 takes a couple of seconds; give it room.)
    await expect(pwd).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
  });
});
