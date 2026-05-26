/**
 * Capture the listing screenshots used by the Chrome Web Store and the
 * web's marketing pages. Driven by Playwright so we can re-run from CI
 * and never ship a stale "Dashboard" capture from three versions ago.
 *
 * Pre-req: a built web wallet is running on http://localhost:3000.
 *   pnpm --filter @thanos/web build
 *   pnpm --filter @thanos/web start &
 *
 * Run:
 *   pnpm --filter @thanos/web exec playwright install chromium
 *   pnpm --filter @thanos/web exec tsx scripts/capture-screenshots.ts
 *
 * Outputs go to apps/web/store/screenshots/<width>x<height>/.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL  = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT_DIR   = process.env.OUT_DIR  ?? 'store/screenshots';
const PASSWORD  = 'capture-password-123';

interface ShotSize { name: string; width: number; height: number }
const SIZES: ShotSize[] = [
  { name: 'chrome-1280x800', width: 1280, height: 800 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];

async function createWallet(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/app`);
  await page.getByRole('button', { name: 'Create new wallet' }).click();
  await page.locator('.phrase-len-tile').first().click();
  await page.getByRole('button', { name: 'I understand' }).click();
  // Capture seed
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const cell = page.locator('.seed-word').nth(i);
    const raw  = (await cell.innerText()).trim();
    words.push(raw.replace(/^\d+\.\s*/, '').trim());
  }
  await page.getByRole('button', { name: "I've saved it" }).click();
  // Verify
  const slots = page.locator('.seed-word.seed-slot');
  const slotCount = await slots.count();
  const missingIdx: number[] = [];
  for (let i = 0; i < slotCount; i++) {
    const numText = (await slots.nth(i).locator('.seed-num').innerText()).trim();
    missingIdx.push(parseInt(numText, 10) - 1);
  }
  missingIdx.sort((a, b) => a - b);
  for (const idx of missingIdx) {
    await page.locator('.seed-pool').getByRole('button', { name: words[idx], exact: true }).first().click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Password
  await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await page.getByPlaceholder('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 30_000 });
}

async function captureFor(size: ShotSize): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await ctx.newPage();
  const dir = join(OUT_DIR, size.name);
  await mkdir(dir, { recursive: true });

  await createWallet(page);

  // 1. Dashboard
  await page.screenshot({ path: join(dir, '01-dashboard.png'), fullPage: false });

  // 2. Send modal
  await page.getByRole('button', { name: 'Send' }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/0x|litho1|name\.litho/i).first().fill('alice.litho');
  await page.screenshot({ path: join(dir, '02-send-modal.png'), fullPage: false });
  await page.keyboard.press('Escape');

  // 3. Swap modal
  await page.getByRole('button', { name: 'Swap' }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, '03-swap-modal.png'), fullPage: false });
  await page.keyboard.press('Escape');

  // 4. Portfolio
  await page.goto(`${BASE_URL}/app/portfolio`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, '04-portfolio.png'), fullPage: false });

  // 5. Permissions
  await page.goto(`${BASE_URL}/app/permissions`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, '05-permissions.png'), fullPage: false });

  // 6. Settings
  await page.goto(`${BASE_URL}/app/settings`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, '06-settings.png'), fullPage: false });

  await browser.close();
  console.log(`✓ ${dir}`);
}

(async () => {
  for (const size of SIZES) await captureFor(size);
})();
