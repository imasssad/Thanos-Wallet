import { test, expect } from '@playwright/test';

/**
 * A copied recovery phrase doesn't stay on the clipboard: it is wiped 60 s
 * later (sdk-core secret-clipboard). Driven with Playwright's clock.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('the copied recovery phrase is wiped from the clipboard after 60 s', async ({ page }) => {
  await page.clock.install();
  await page.goto('/app');
  await page.getByRole('button', { name: /^create (a )?new wallet$/i }).click();
  await page.locator('.phrase-len-tile').first().click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.locator('.seed-word')).toHaveCount(12);
  const words: string[] = [];
  for (let i = 0; i < 12; i++) words.push((await page.locator('.seed-word').nth(i).innerText()).trim().replace(/^\d+\.\s*/, ''));

  await page.getByRole('button', { name: /copy phrase/i }).click();
  await expect(page.getByText('Copied — clears in 60 s')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(words.join(' '));

  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(words.join(' '));
  await page.clock.fastForward(31_000);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('');
});
