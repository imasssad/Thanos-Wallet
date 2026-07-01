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

/**
 * m/44'/60'/0'/0 parent node. The mnemonic→seed step is PBKDF2-HMAC-SHA512 with
 * 2048 rounds — expensive in pure JS on Hermes. Deriving it ONCE here and then
 * deriveChild(idx) per account (cheap EC math) is the fix: deriveEvmAddressAt()
 * used to call HDNodeWallet.fromPhrase() — which re-runs the full 2048-round seed
 * derivation — on EVERY call. Scanning all MAX_ACCOUNTS indices that way ran the
 * seed derivation MAX_ACCOUNTS times back-to-back and froze the JS thread for
 * minutes right after unlock (the "blank home for 3-4 min" report).
 */
function accountParentNode(seed: string[]): HDNodeWallet {
  // fromPhrase computes the seed ONCE at the parent path m/44'/60'/0'/0; each
  // deriveChild(idx) below is then cheap EC math. NOTE: fromMnemonic(mnemonic)
  // WITHOUT a path does NOT return the master — it defaults to m/44'/60'/0'/0/0,
  // so deriving the parent that way yields wrong addresses. Keep the explicit path.
  return HDNodeWallet.fromPhrase(seed.join(' '), undefined, "m/44'/60'/0'/0");
}

/** EVM (0x) address for a given HD account index. */
export function deriveEvmAddressAt(seed: string[], idx: number): string {
  return accountParentNode(seed).deriveChild(idx).address;
}

/** Derive every account address 0..count-1 — seed derived ONCE, children cheap. */
export function deriveAccountAddresses(seed: string[], count: number): string[] {
  if (!seed || seed.length === 0) return [];
  const parent = accountParentNode(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    try { out.push(parent.deriveChild(i).address); } catch { out.push(''); }
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
  // Derive the seed ONCE, then one cheap child per index — was MAX_ACCOUNTS full
  // BIP39 seed derivations back-to-back, the JS-thread freeze right after unlock.
  const parent = accountParentNode(seed);
  const results = await Promise.allSettled(
    Array.from({ length: MAX_ACCOUNTS }, (_, i) => i).map(async (i) => {
      let addr = '';
      try { addr = parent.deriveChild(i).address; } catch { return { i, funded: false }; }
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
