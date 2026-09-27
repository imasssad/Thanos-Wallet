import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Auto-lock (Settings → Security → Auto-lock): the chosen timeout is saved
 * and enforced — the wallet locks after that long without input, input keeps
 * it open, time the machine spends asleep counts, and a reload after the
 * timeout lands on the unlock screen instead of reopening the vault from the
 * tab's cached key. Time is driven with Playwright's clock; fastForward()
 * behaves like a laptop lid closed for that long.
 */

const PASSWORD = 'auto-lock-pw-555';
const unlockField = (page: import('@playwright/test').Page) => page.getByPlaceholder('Enter password');

test.describe('Auto-lock', () => {
  test('locks after the chosen idle timeout; input keeps it open', async ({ page }) => {
    await page.clock.install();
    await createWallet(page, PASSWORD);
    await page.goto('/app/settings');

    const timeout = page.getByLabel('Auto-lock timeout');
    await expect(timeout).toHaveValue('15'); // the default
    await timeout.selectOption('1');
    expect(await page.evaluate(() => localStorage.getItem('thanos.autolock_minutes'))).toBe('1');

    await page.clock.fastForward(40_000);
    await page.mouse.move(40, 40);
    await page.mouse.move(80, 80);
    await page.clock.fastForward(40_000);
    await expect(unlockField(page)).toHaveCount(0);

    await page.clock.fastForward(70_000); // idle (asleep) past the minute
    await expect(unlockField(page)).toBeVisible({ timeout: 10_000 });
    await unlockField(page).fill(PASSWORD);
    await page.getByRole('button', { name: /unlock/i }).click();
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible({ timeout: 30_000 });
  });

  test('"Never" says what it means and does not lock', async ({ page }) => {
    await page.clock.install();
    await createWallet(page, PASSWORD);
    await page.goto('/app/settings');
    await page.getByLabel('Auto-lock timeout').selectOption('0');
    await expect(page.getByText(/^Off\. The wallet stays unlocked until you lock it yourself/)).toBeVisible();
    await page.clock.fastForward(2 * 60 * 60_000);
    await expect(unlockField(page)).toHaveCount(0);
  });

  test('a reload after the timeout does not reopen the wallet from the cached key', async ({ page }) => {
    await createWallet(page, PASSWORD);
    await page.evaluate(() => localStorage.setItem('thanos.autolock_minutes', '5'));

    await page.reload(); // within the timeout: the cached key still reopens it
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(unlockField(page)).toHaveCount(0);

    // The tab sat idle for 10 minutes and is reloaded before any check ran.
    await page.evaluate(() => sessionStorage.setItem('thanos.last_activity', String(Date.now() - 10 * 60_000)));
    await page.reload();
    await expect(unlockField(page)).toBeVisible({ timeout: 15_000 });
  });
});
