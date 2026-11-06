import { test, expect, type Page, type Route } from '@playwright/test';
import { AbiCoder, id } from 'ethers';
import {
  NATIVE_GATEWAY_ABI, NATIVE_LITHIC_GATEWAY, encodeLval, type LvalInput,
} from '../../../packages/sdk-core/src/clients/native-lithic';
import { createWallet } from './helpers';

/**
 * Native Lithic LAX on Makalu: with Makalu added as a custom network, the
 * dashboard reads native LAX through the native gateway and shows it
 * view-only. The Makalu RPC (the same-origin /rpc/makalu proxy) is answered
 * here like the live gateway — LVAL inside an ABI `bytes` wrapper.
 */

const MAKALU = {
  chainId: 700777, name: 'Lithosphere Makalu', rpcUrl: 'https://rpc.litho.ai',
  nativeSymbol: 'LITHO', explorerUrl: 'https://makalu.litho.ai', custom: true,
};

type Req = { jsonrpc: string; id: number; method: string; params: Array<{ to?: string; data?: string }> };

function makaluRpc(opts: { balance?: bigint; broken?: boolean } = {}) {
  const gatewayCalls: string[] = [];
  const values: Record<string, LvalInput> = {
    'name()': { type: 'string', value: 'Lithosphere Algorithmic' },
    'symbol()': { type: 'string', value: 'LAX' },
    'decimals()': { type: 'u64', value: '18' },
    'balance_of(address)': { type: 'u256', value: opts.balance ?? 0n },
  };
  const answer = (req: Req) => {
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id, result });
    if (req.method === 'eth_chainId') return ok('0xab169');
    if (req.method === 'eth_blockNumber') return ok('0x1190000');
    if (req.method === 'eth_getBalance') return ok('0x0');
    if (req.method === 'eth_call' && req.params[0]?.to?.toLowerCase() === NATIVE_LITHIC_GATEWAY) {
      const [, selector] = NATIVE_GATEWAY_ABI.decodeFunctionData('call', req.params[0].data!);
      gatewayCalls.push(selector as string);
      if (opts.broken) return { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'execution reverted' } };
      const sig = Object.keys(values).find((k) => id(k) === selector)!;
      return ok(AbiCoder.defaultAbiCoder().encode(['bytes'], [encodeLval([values[sig]])]));
    }
    return ok('0x');
  };
  const handler = async (route: Route) => {
    const body = route.request().postDataJSON() as Req | Req[];
    const out = Array.isArray(body) ? body.map(answer) : answer(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  };
  return { gatewayCalls, handler };
}

async function withMakalu(page: Page): Promise<void> {
  await page.addInitScript((chain) => {
    localStorage.setItem('thanos.custom_evm_chains.v1', JSON.stringify([chain]));
  }, MAKALU);
}

test.describe('Native Lithic LAX (Makalu)', () => {
  test('shows the native LAX balance, view-only, when Makalu is added', async ({ page }) => {
    const rpc = makaluRpc({ balance: 1234n * 10n ** 18n + 5n * 10n ** 17n });
    await page.route('**/rpc/makalu', rpc.handler);
    await withMakalu(page);
    await createWallet(page);

    const row = page.getByRole('button').filter({ hasText: 'Makalu native · view only' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1,234.5 LAX');
    // Read with the native signature through the gateway, never ERC-20 balanceOf.
    expect(rpc.gatewayCalls).toContain(id('balance_of(address)'));
    expect(rpc.gatewayCalls).not.toContain(id('balanceOf(address)'));

    await row.click();
    const screen = page.getByTestId('native-asset');
    await expect(screen).toContainText('1,234.5 LAX');
    await expect(screen).toContainText('View only');
    await expect(screen).toContainText('Lithosphere Makalu');
    await expect(screen.getByRole('button', { name: /send|swap|receive/i })).toHaveCount(0);
  });

  test('without Makalu there is no native LAX row and no gateway read', async ({ page }) => {
    const rpc = makaluRpc({ balance: 10n ** 18n });
    await page.route('**/rpc/makalu', rpc.handler);
    await createWallet(page);
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Makalu native/)).toHaveCount(0);
    expect(rpc.gatewayCalls).toHaveLength(0);
  });

  test('a failed read shows as unavailable, never as 0', async ({ page }) => {
    const rpc = makaluRpc({ broken: true });
    await page.route('**/rpc/makalu', rpc.handler);
    await withMakalu(page);
    await createWallet(page);

    const row = page.getByRole('button').filter({ hasText: 'Makalu native · balance unavailable' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('0 LAX');
    await row.click();
    await expect(page.getByTestId('native-asset')).toContainText('Unavailable');
  });
});
