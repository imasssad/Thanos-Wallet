/**
 * HD account discovery.
 *
 * The wallet is multi-account: each "account" is an HD index under
 * m/44'/60'/0'/0/{idx}. The Dashboard only ever queries the *active* account,
 * and a fresh/imported wallet starts at accountCount = 1 (index 0 only). So a
 * deposit made to a non-active index — or any account on a wallet imported on a
 * new device — is BOTH invisible (never queried) AND unreachable (not in the
 * switcher). That's the "deposit not showing" bug.
 *
 * `discoverFundedAccountCount` scans the first MAX_ACCOUNTS indices and reports
 * how many accounts should be exposed so every funded account is reachable in
 * the switcher. It only ever GROWS the count — it never hides an account the
 * user already has.
 */
import { Mnemonic, HDNodeWallet } from 'ethers';
import { getMakaluProvider, getKametProvider } from './rpc';
import { MAX_ACCOUNTS } from './vault';

/** EVM (0x, EIP-55 checksummed) address for a given HD account index. */
export function deriveEvmAddressAt(seed: string[], idx: number): string {
  const m = Mnemonic.fromPhrase(seed.join(' '));
  return HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${idx}`).address;
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
 * Makalu OR Kamet, so funded accounts become reachable in the switcher.
 * Returns the account count to persist: (highest funded index) + 1, clamped to
 * [1, MAX_ACCOUNTS]. Best-effort: an RPC failure for an index counts as "not
 * funded" (so discovery can only ever grow the count, never shrink it).
 */
export async function discoverFundedAccountCount(seed: string[]): Promise<number> {
  if (!seed || seed.length === 0) return 1;
  const results = await Promise.allSettled(
    Array.from({ length: MAX_ACCOUNTS }, (_, i) => i).map(async (i) => {
      const addr = deriveEvmAddressAt(seed, i);
      const [mak, kam] = await Promise.allSettled([
        getMakaluProvider().getBalance(addr),
        getKametProvider().getBalance(addr),
      ]);
      const val = (r: PromiseSettledResult<bigint>) => (r.status === 'fulfilled' ? r.value : 0n);
      return { i, funded: val(mak) > 0n || val(kam) > 0n };
    }),
  );
  let highest = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.funded && r.value.i > highest) highest = r.value.i;
  }
  return Math.min(MAX_ACCOUNTS, highest + 1);
}
