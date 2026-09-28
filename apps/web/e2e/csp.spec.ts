import { test, expect, type Page } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * The wallet's nonce Content-Security-Policy (middleware.ts, lib/csp.js),
 * enforced — the other specs bypass page CSP. Markup injected into the
 * wallet must not run script: no 'unsafe-inline', only Next's nonce'd
 * scripts.
 */
test.use({ bypassCSP: false });

const CREATE = /^create (a )?new wallet$/i;

function scriptSrc(csp: string | undefined): string {
  return (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) ?? '';
}

/** Record CSP violations (effective directive) from the first script on. */
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on('console', (m) => { if (m.text().startsWith('CSP-VIOLATION ')) seen.push(m.text().slice(14)); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.log(`CSP-VIOLATION ${e.effectiveDirective}`));
  });
  return seen;
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __csp_probe?: number }).__csp_probe);

/** An injection bug rendering markup into the live wallet (e.g. through
 *  dangerouslySetInnerHTML): its event handler must not run. */
async function injectHandler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = '<img src="data:," onerror="window.__csp_probe = 1">';
    document.body.append(div);
  });
  await page.waitForTimeout(300);
}

test('the wallet gets a fresh nonce policy without unsafe-inline, and still works', async ({ page }) => {
  const violations = await watchViolations(page);
  const first = await page.goto('/app');
  const policy = scriptSrc(first?.headers()['content-security-policy']);
  expect(policy).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("'unsafe-inline'");

  const again = await page.request.get('/app');
  expect(scriptSrc(again.headers()['content-security-policy'])).not.toBe(policy);

  // Next's scripts carry the nonce, so the wallet boots — through onboarding.
  await createWallet(page);
  expect(violations.filter((v) => v.startsWith('script-src'))).toEqual([]);

  await injectHandler(page);
  expect(await probe(page)).toBeUndefined();
  expect(violations).toContain('script-src-attr');
});

test('markup injected into the served wallet page does not run', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.route((url) => url.pathname === '/app', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '</body>',
      '<img src="data:," onerror="window.__csp_probe = 1"><script>window.__csp_probe = 2</script></body>',
    );
    await route.fulfill({ response, body });
  });

  await page.goto('/app');
  await expect(page.getByRole('button', { name: CREATE })).toBeVisible();
  expect(await probe(page)).toBeUndefined();
  expect(violations).toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr']));
});

test('Open wallet on the landing page is a full load into the wallet policy', async ({ page }) => {
  const landing = await page.goto('/');
  // Public pages stay static and cacheable: no per-request nonce there.
  expect(scriptSrc(landing?.headers()['content-security-policy'])).toContain("'unsafe-inline'");

  const [nav] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/app' && r.request().resourceType() === 'document'),
    page.getByRole('link', { name: /open wallet/i }).first().click(),
  ]);
  expect(scriptSrc(nav.headers()['content-security-policy'])).not.toContain("'unsafe-inline'");
  await expect(page.getByRole('button', { name: CREATE })).toBeVisible();
  // Under the landing page's policy this handler would run.
  await injectHandler(page);
  expect(await probe(page)).toBeUndefined();
});
