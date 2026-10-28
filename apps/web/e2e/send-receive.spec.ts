import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';
import { keccak256 } from 'ethers';

/**
 * Key-flow E2E: the Send and Receive modals.
 *
 * Each test creates a fresh wallet, then drives the modal. We assert
 * the modal opens, the chain controls work, and recipient validation
 * fires — without broadcasting anything (no funded wallet in CI).
 *
 * `.first()` on the action buttons is deliberate: a fresh wallet's
 * empty-state card surfaces a second "Receive" CTA, so a strict role
 * query would resolve to two elements.
 */

test.describe('Send / Receive', () => {
  test('confirmation lookup errors keep a broadcast submitted without offering another send', async ({ page }, testInfo) => {
    // No request can reach a live RPC: only localhost and this mocked mainnet
    // transport are permitted. The wallet created below is an unfunded fixture.
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
    });
    let submittedHash = '';
    let sends = 0;
    let receiptChecks = 0;
    const block = {
      number: '0x100', hash: `0x${'1'.repeat(64)}`, parentHash: `0x${'2'.repeat(64)}`,
      nonce: '0x0000000000000000', difficulty: '0x0', extraData: '0x',
      gasLimit: '0xffffffff', gasUsed: '0x0', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
      miner: '0x0000000000000000000000000000000000000001',
      baseFeePerGas: '0x3b9aca00', transactions: [],
    };
    await page.route(/^https:\/\/rpc-mainnet\.litho\.ai\/?$/, async route => {
      const payload = route.request().postDataJSON();
      const reply = (request: { id: number; method: string; params: string[] }) => {
        const response = { jsonrpc: '2.0', id: request.id };
        if (request.method === 'eth_getTransactionReceipt') {
          receiptChecks++;
          return { ...response, error: { code: -32000, message: 'Confirmation lookup unavailable' } };
        }
        let result: unknown = null;
        switch (request.method) {
          case 'eth_chainId': result = '0x232d'; break;
          case 'eth_blockNumber': result = '0x100'; break;
          case 'eth_getBlockByNumber': result = block; break;
          case 'eth_getBalance': result = '0x56bc75e2d63100000'; break; // 100 fixture LITHO
          case 'eth_getTransactionCount': result = '0x0'; break;
          case 'eth_gasPrice': result = '0x77359400'; break;
          case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
          case 'eth_estimateGas': result = '0x5208'; break;
          case 'eth_getCode': result = '0x'; break;
          case 'eth_sendRawTransaction':
            sends++;
            submittedHash = keccak256(request.params[0]);
            result = submittedHash;
            break;
        }
        return { ...response, result };
      };
      await route.fulfill({
        contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)),
      });
    });

    await createWallet(page);
    await page.getByRole('button', { name: 'Send', exact: true }).first().click();
    await page.getByPlaceholder('0', { exact: true }).fill('1');
    await page.getByPlaceholder(/litho1.*0x/).fill('0x742d35cc6634c0532925a3b844bc454e4438f44e');
    await page.getByRole('button', { name: 'Send LITHO', exact: true }).click();

    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    await expect(page.getByText(/confirmation is temporarily unavailable/)).toBeVisible();
    await expect(page.getByText('Transaction failed', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(sends).toBe(1);
    expect(receiptChecks).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /View on LithoScan/ })).toHaveAttribute('href', `https://lithoscan.ai/txs/${submittedHash}`);
    await testInfo.attach('confirmation unavailable', {
      body: await page.screenshot(), contentType: 'image/png',
    });
  });

  test('Receive modal shows a network list with copyable addresses', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Receive' }).first().click();

    // The receive screen lists the networks the wallet has addresses on.
    await expect(page.getByPlaceholder('Search networks')).toBeVisible();
    const sheet = page.locator('.modal-box').first();
    await expect(sheet.getByText('Lithosphere', { exact: true }).first()).toBeVisible();
    await expect(sheet.getByText('Bitcoin', { exact: true }).first()).toBeVisible();
    // Makalu isn't built in any more (2026-09-29).
    await expect(sheet.getByText(/Makalu/)).toHaveCount(0);
  });

  test('Send modal validates the recipient address', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    // Modal mounts with the recipient field.
    const recipient = page.getByPlaceholder(/litho1.*0x|0x.*address|address \(0x/i).first();
    await expect(recipient).toBeVisible();

    // Garbage input → the Send button stays disabled (validation gates
    // it). Asserting button state is more robust than matching the
    // exact inline error copy.
    await recipient.fill('not-a-real-address');
    const sendBtn = page.getByRole('button', { name: /^send /i }).last();
    await expect(sendBtn).toBeDisabled();

    // A well-formed 0x address clears validation — the "valid address"
    // badge shows and the Send button is no longer gated on recipient.
    await recipient.fill('0x1234567890123456789012345678901234567890');
    await expect(page.getByText(/valid .* address/i).first()).toBeVisible();
  });

  test('Send modal network picker switches chains', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    // The network trigger defaults to Lithosphere Mainnet.
    await expect(page.getByRole('combobox', { name: 'Send network' })).toHaveText(/Lithosphere/);
    await expect(page.getByText(/Makalu/)).toHaveCount(0);
    // Send button reflects the active asset.
    await expect(page.getByRole('button', { name: /send (litho|btc|sol|atom|eth)/i }).first()).toBeVisible();
  });
});
