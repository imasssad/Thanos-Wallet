import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for the web wallet.
 *
 * `webServer` runs a PRODUCTION build (`next build && next start`), not
 * `next dev`, on purpose: the wallet's Content-Security-Policy omits
 * `'unsafe-eval'` (correct for prod), but Next's dev HMR *requires*
 * eval — so `next dev` renders blank under that CSP. The prod bundle
 * uses no eval, matches what actually ships, and is the right thing to
 * E2E-test anyway. The first run pays a one-off `next build`.
 *
 * The wallet degrades gracefully when the backend (api / indexer) is
 * offline — the dashboard shows its empty state — so E2E needs only
 * the web app, not the Docker stack.
 *
 * Vault creation runs Argon2id (t=3, m=64MB) in the browser, which
 * takes a couple of seconds; the timeouts below are sized for that.
 *
 * First run needs the browser binary:  npx playwright install chromium
 */
export default defineConfig({
  testDir:  './e2e',
  timeout:  90_000,
  expect:   { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries:  process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace:   'on-first-retry',
    /* The wallet ships a strict CSP that omits 'unsafe-eval'. A bundled
       dependency (protobufjs, pulled in by @cosmjs) uses Function()-eval
       at init; in production nginx serves the relaxed CSP, but a bare
       `next start` serves Next's own strict header and the eval throws,
       blanking the app. E2E exercises wallet behaviour, not the CSP
       header — so the test browser ignores page CSP. */
    bypassCSP: true,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // Production build — see the eval/CSP note above. `next start`
    // serves on 3000. reuseExistingServer lets a server you already
    // have up be reused locally; CI always builds fresh.
    command: 'npm run build && npm run start',
    url:     'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 360_000,
  },
});
