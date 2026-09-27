import { test, expect, type Page, type Route } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Quantts Agents on the web wallet, against a MOCKED Quantts API — there is
 * no Quantt sandbox, so nothing here may reach api.quantts.ai. Covers wallet
 * sign-in through the real signing worker, the kill-switch banner, agent
 * Settings (a PATCH carrying only the changed fields, schema-checked first),
 * live decisions over the SSE stream, that a tampered sign-in challenge is
 * refused before anything is signed, and that locking the wallet drops the
 * Quantt login.
 */

const AGENT = {
  id: 'ag_1', userId: 'u_1', name: 'Momentum ETH', strategy: 'momentum', strategyPrompt: null,
  chains: ['arbitrum'], tokens: ['ETH'], dexPreference: 'kamet', walletAddress: '0x1111111111111111111111111111111111111111',
  walletDerivationIndex: 3, custodyModel: 'derived', capitalUsd: 500, maxPositionPct: 25, stopLoss: 5,
  takeProfit: 10, maxDailyLoss: 3.5, status: 'paused', autopilot: true, timeframe: '1h', quoteAsset: 'USDC',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
};
const PERMIT2 = {
  domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
  types: {
    PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
    PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
  },
  primaryType: 'PermitSingle',
  message: {
    details: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: '1461501637330902918203684832716283019655932542975', expiration: 0, nonce: 0 },
    spender: '0x000000000022D473030F116dDEE9F6B43aC78BA3', sigDeadline: '99999999999',
  },
};

interface Captured { patches: unknown[]; verifies: number; logouts: number }

async function mockQuantt(page: Page, opts: { tamperChallenge?: boolean } = {}): Promise<Captured> {
  const cap: Captured = { patches: [], verifies: 0, logouts: 0 };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route('https://api.quantts.ai/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    if (path === '/v1/auth/wallet/typed-challenge') {
      if (opts.tamperChallenge) return json(PERMIT2);
      const { address } = JSON.parse(req.postData() ?? '{}') as { address: string };
      return json({
        domain: { name: 'Quantts.ai', version: '1', chainId: 700777 },
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }],
          SignIn: [{ name: 'address', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'validUntil', type: 'uint256' }],
        },
        primaryType: 'SignIn',
        message: { address, nonce: `0x${'ab'.repeat(32)}`, validUntil: 1_900_000_000 },
      });
    }
    if (path === '/v1/auth/wallet/typed-verify') { cap.verifies++; return json({ accessToken: 'at', refreshToken: 'rt' }); }
    if (path === '/v1/auth/logout') { cap.logouts++; return json({ ok: true }); }
    if (path === '/v1/dashboard/overview') {
      return json({ dashboard: {
        portfolio: { equity: 1234, pnl24h: 1.2, pnl7d: 2.5, pnl30d: 4.1, activeAgents: 0 },
        agents: [{ id: 'ag_1', name: 'Momentum ETH', chain: 'arbitrum', status: 'paused' }],
      } });
    }
    if (path === '/v1/kill-switch') {
      return json({ armed: true, armedBy: 'ops', reason: 'Exchange maintenance', armedAt: '2026-09-27T10:00:00Z' });
    }
    if (path === '/v1/agents/ag_1' && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      cap.patches.push(body);
      return json({ ...AGENT, ...body });
    }
    if (path === '/v1/agents/ag_1') return json(AGENT);
    if (path === '/v1/agents/ag_1/decisions') {
      return json({ items: [{ id: 'd1', agentId: 'ag_1', symbol: 'ETH', status: 'executed', riskStatus: 'approved' }] });
    }
    if (path === '/v1/agents/ag_1/decisions/stream') {
      return route.fulfill({
        status: 200, contentType: 'text/event-stream', headers: cors,
        body: 'event: decision\ndata: {"id":"d2","agentId":"ag_1","symbol":"ARB","status":"streamed-live"}\n\n',
      });
    }
    return json({ error: `unmocked ${req.method()} ${path}` }, 404);
  });
  return cap;
}

async function openQuantts(page: Page) {
  await page.getByRole('button', { name: 'Quantts', exact: true }).click();
}

test.describe('Quantts Agents (mocked API)', () => {
  test('sign in, kill-switch banner, edit settings, live decisions', async ({ page }) => {
    const cap = await mockQuantt(page);
    await createWallet(page);
    await openQuantts(page);

    await page.getByRole('button', { name: 'Connect with Thanos' }).click();
    await expect(page.getByText('● Connected')).toBeVisible();
    expect(cap.verifies).toBe(1);
    await expect(page.getByText(/halted all agent trading: Exchange maintenance/).first()).toBeVisible();

    // Agent detail: the halt blocks Start.
    await page.getByRole('button', { name: /Momentum ETH/ }).first().click();
    const modal = page.locator('.modal-box.modal-popup');
    await expect(modal.getByText(/halted all agent trading/)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Start' })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Pause' })).toBeDisabled(); // already paused
    await expect(modal.getByRole('button', { name: 'Stop' })).toBeEnabled();

    // Settings: out-of-range value is refused client-side, nothing is sent.
    await modal.getByRole('button', { name: 'Settings', exact: true }).click();
    const takeProfit = modal.getByLabel('Take profit (%)');
    await expect(takeProfit).toHaveValue('10');
    await takeProfit.fill('900');
    await modal.getByRole('button', { name: 'Review changes' }).click();
    await expect(modal.getByText('Take profit % must be at least 0 and at most 500.')).toBeVisible();
    expect(cap.patches).toHaveLength(0);

    // A valid edit is confirmed with a before/after summary and PATCHes only what changed.
    await takeProfit.fill('10');
    await modal.getByLabel('Stop loss (%)').fill('7');
    await modal.getByLabel(/Autopilot/).uncheck();
    await modal.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByText(/Stop loss: 5% → 7%/)).toBeVisible();
    await expect(page.getByText(/Autopilot: On → Off/)).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    expect(cap.patches).toEqual([{ stopLoss: 7, autopilot: false }]);

    // Decisions: the page load plus the decision that arrived over the stream.
    await modal.getByRole('button', { name: 'Decisions', exact: true }).click();
    await expect(modal.getByText('streamed-live')).toBeVisible();
    await expect(modal.getByText('executed')).toBeVisible();
  });

  test('a tampered sign-in challenge is refused before signing', async ({ page }) => {
    const cap = await mockQuantt(page, { tamperChallenge: true });
    await createWallet(page);
    await openQuantts(page);
    await page.getByRole('button', { name: 'Connect with Thanos' }).click();
    await expect(page.getByText(/Refusing to sign the Quantt challenge: domain name is "Permit2"/)).toBeVisible();
    expect(cap.verifies).toBe(0);
    await expect(page.getByText('● Connected')).toHaveCount(0);
  });

  test('locking the wallet drops the Quantt login', async ({ page }) => {
    const cap = await mockQuantt(page);
    const password = 'quantt-lock-pw-777';
    await createWallet(page, password);
    await openQuantts(page);
    await page.getByRole('button', { name: 'Connect with Thanos' }).click();
    await expect(page.getByText('● Connected')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('quantt_session'))).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('quantt_session'))).toBeNull();

    await page.locator('.account-chip').click();
    await page.getByRole('button', { name: /lock wallet/i }).click();
    const pwd = page.getByPlaceholder('Enter password');
    await expect(pwd).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => sessionStorage.getItem('quantt_session'))).toBeNull();
    await expect.poll(() => cap.logouts).toBe(1);

    await pwd.fill(password);
    await page.getByRole('button', { name: /unlock/i }).click();
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible({ timeout: 30_000 });
    await openQuantts(page);
    await expect(page.getByRole('button', { name: 'Connect with Thanos' })).toBeVisible();
  });
});
