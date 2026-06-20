/**
 * HD account discovery (mobile) — mirrors apps/web/lib/account-discovery.ts.
 *
 * Each "account" is an HD index under m/44'/60'/0'/0/{idx}. The portfolio only
 * queries the ACTIVE account, and a fresh/imported wallet starts at
 * accountCount = 1 (index 0). So a deposit to a non-active index — or any
 * account on a wallet imported on a new device — is both invisible (never
 * queried) and unreachable (not in the switcher). This scans the first
 * MAX_ACCOUNTS indices and reports how many accounts to expose so every funded
 * account is reachable. It only ever GROWS the count.
 */
import { HDNodeWallet, JsonRpcProvider } from 'ethers';
import { MAX_ACCOUNTS } from './accounts';

const MAKALU_RPC = 'https://rpc.litho.ai';
const KAMET_RPC  = 'https://rpc-3.litho.ai';

let _mak: JsonRpcProvider | null = null;
let _kam: JsonRpcProvider | null = null;
const makalu = () => (_mak ??= new JsonRpcProvider(MAKALU_RPC, 700777, { staticNetwork: true }));
const kamet  = () => (_kam ??= new JsonRpcProvider(KAMET_RPC, 900523, { staticNetwork: true }));

/** EVM (0x) address for a given HD account index. */
export function deriveEvmAddressAt(seed: string[], idx: number): string {
  return HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${idx}`).address;
}

/** Derive every account address from 0..count-1 (for the switcher / labels). */
export function deriveAccountAddresses(seed: string[], count: number): string[] {
  if (!seed || seed.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    try { out.push(deriveEvmAddressAt(seed, i)); } catch { out.push(''); }
  }
  return out;
}

/**
 * Scan HD indices 0..MAX_ACCOUNTS-1 for any account holding a native balance on
 * Makalu OR Kamet. Returns the account count to persist (highest funded index +
 * 1), clamped to [1, MAX_ACCOUNTS]. Best-effort — RPC failures count as "not
 * funded", so discovery can only grow the count, never shrink it.
 */
export async function discoverFundedAccountCount(seed: string[]): Promise<number> {
  if (!seed || seed.length === 0) return 1;
  const results = await Promise.allSettled(
    Array.from({ length: MAX_ACCOUNTS }, (_, i) => i).map(async (i) => {
      const addr = deriveEvmAddressAt(seed, i);
      const [m, k] = await Promise.allSettled([makalu().getBalance(addr), kamet().getBalance(addr)]);
      const v = (r: PromiseSettledResult<bigint>) => (r.status === 'fulfilled' ? r.value : 0n);
      return { i, funded: v(m) > 0n || v(k) > 0n };
    }),
  );
  let highest = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.funded && r.value.i > highest) highest = r.value.i;
  }
  return Math.min(MAX_ACCOUNTS, highest + 1);
}
