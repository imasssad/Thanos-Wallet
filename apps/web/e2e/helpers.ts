import { type Page, expect } from '@playwright/test';

/**
 * Shared E2E helpers — driving the wallet through onboarding so each
 * spec starts from a known state.
 */

/**
 * Walk the full create-wallet onboarding from a fresh browser context:
 *   welcome → 12-word length → risk warning → show phrase → verify
 *   phrase → set password → dashboard.
 *
 * Reads the generated seed off the "show phrase" screen and re-enters
 * the missing words on the verify screen, so it works against a real
 * random mnemonic — no fixtures, no mocking.
 */
export async function createWallet(page: Page, password = 'test-password-123'): Promise<void> {
  await page.goto('/app');

  // welcome
  await page.getByRole('button', { name: 'Create new wallet' }).click();

  // create-length — pick the 12-word option (first phrase-length tile)
  await page.locator('.phrase-len-tile').first().click();

  // create-warn
  await page.getByRole('button', { name: 'I understand' }).click();

  // create-show — capture the seed words in order
  await expect(page.locator('.seed-word')).toHaveCount(12);
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const cell = page.locator('.seed-word').nth(i);
    // Each cell is `<span.seed-num>N.</span><span>word</span>` — the word
    // is the cell text minus the leading number.
    const raw = (await cell.innerText()).trim();
    words.push(raw.replace(/^\d+\.\s*/, '').trim());
  }
  await page.getByRole('button', { name: "I've saved it" }).click();

  // create-confirm — fill the missing slots from the word pool, in the
  // ascending slot order the component expects.
  const missingIdx: number[] = [];
  const slots = page.locator('.seed-word.seed-slot');
  const slotCount = await slots.count();
  for (let i = 0; i < slotCount; i++) {
    const numText = (await slots.nth(i).locator('.seed-num').innerText()).trim();
    missingIdx.push(parseInt(numText, 10) - 1);
  }
  missingIdx.sort((a, b) => a - b);
  for (const idx of missingIdx) {
    await page.locator('.seed-pool')
      .getByRole('button', { name: words[idx], exact: true })
      .first()
      .click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  // create-pwd
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create wallet' }).click();

  // Dashboard — the 4 action buttons confirm we landed.
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
}
