/**
 * Optimistic local activity log (desktop).
 *
 * The indexer only sees LEP100 Transfer events on Makalu, so native LITHO and
 * external-chain sends never appear in the Activity feed. We record every
 * successful send locally (keyed by the wallet's EVM address) and the
 * portfolio hook merges it in, deduped against the indexer by tx hash so a
 * LEP100 send doesn't show twice once the indexer catches up.
 *
 * RESOLUTION (added 2026-09-16, client-reported "need all activity to show" /
 * stuck-Pending rows): Makalu/Kamet/Mainnet native LITHO get promoted out of
 * "Pending" via explorer-activity.ts's explorer feeds. But every one of the 8
 * external EVM chains (Ethereum/BNB/Polygon/Base/Arbitrum/Linea/Optimism/
 * Avalanche — routed through evm-external's sendExtEvm) has NO indexer or
 * explorer coverage at all, for any asset — those rows stayed "Pending"
 * forever. resolvePendingActivity() polls the tx's OWN chain RPC directly for
 * a receipt (no indexer/explorer needed) and flips the stored status in
 * place, so the row stays (doesn't vanish) but shows as sent/failed correctly.
 */
export interface LocalTx {
  hash:     string;
  chain:    string;
  sym:      string;
  amount:   string;
  ts:       number; // epoch ms
  /** The chain this was actually broadcast on — pass the coin's chainId.
   *  Native Makalu/Kamet/Mainnet sends don't need this to resolve (the
   *  explorer feeds cover them), but it's harmless to include. */
  chainId?: number;
  /** Absent/'pending' = still unresolved. Rows recorded before this field
   *  existed are treated as pending (backward compatible). */
  status?:  'pending' | 'confirmed' | 'failed';
}

const keyFor = (addr: string) => `thanos-local-activity:${(addr || '').toLowerCase()}`;
const MAX = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — a dropped/failed tx never lingers past this
const MAX_RESOLVE_PER_PASS = 12;
const RECEIPT_TIMEOUT_MS = 6_000;

export function getLocalActivity(addr: string): LocalTx[] {
  if (!addr || typeof localStorage === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(keyFor(addr)) || '[]');
    if (!Array.isArray(arr)) return [];
    // Expire-on-read: drop entries older than 24h so a tx the indexer never
    // reports (dropped/failed) can't sit as a permanent "Pending" row.
    const cutoff = Date.now() - MAX_AGE_MS;
    const live = (arr as LocalTx[]).filter((t) => typeof t?.ts === 'number' && t.ts >= cutoff);
    if (live.length !== arr.length) {
      try { localStorage.setItem(keyFor(addr), JSON.stringify(live)); } catch { /* non-fatal */ }
    }
    return live;
  } catch {
    return [];
  }
}

export function addLocalActivity(addr: string, tx: LocalTx): void {
  if (!addr || !tx.hash || typeof localStorage === 'undefined') return;
  try {
    const arr = getLocalActivity(addr);
    if (arr.some((t) => t.hash === tx.hash)) return;
    localStorage.setItem(keyFor(addr), JSON.stringify([{ ...tx, status: 'pending' as const }, ...arr].slice(0, MAX)));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

/** Poll each still-pending row's OWN chain for a receipt and flip its status
 *  in place — see the module doc for why this exists. Rows with no chainId
 *  (pre-existing rows, or genuine Makalu/Kamet/Mainnet native sends that
 *  resolve via the explorer feed instead) are left untouched. Best-effort —
 *  an unreachable chain just stays pending and gets retried on the next call
 *  (portfolio load / reload). Returns the up-to-date list. */
export async function resolvePendingActivity(addr: string): Promise<LocalTx[]> {
  const arr = getLocalActivity(addr);
  if (!addr) return arr;
  const pending = arr.filter((t) => (t.status ?? 'pending') === 'pending' && t.chainId != null).slice(0, MAX_RESOLVE_PER_PASS);
  if (pending.length === 0) return arr;

  let evm: typeof import('./evm-external') | null = null;
  try { evm = await import('./evm-external'); } catch { return arr; }

  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);

  const resolutions = await Promise.allSettled(pending.map(async (t) => {
    const chain = evm!.getExtEvmChain(t.chainId!);
    if (!chain) return null; // not a chain this module knows an RPC for
    const receipt = await withTimeout(evm!.getExtEvmProvider(t.chainId!).getTransactionReceipt(t.hash), RECEIPT_TIMEOUT_MS);
    if (!receipt) return null; // still pending, or unreachable — leave as-is
    const status: 'confirmed' | 'failed' = receipt.status === 1 ? 'confirmed' : 'failed';
    return { hash: t.hash, status };
  }));

  const updates = new Map<string, 'confirmed' | 'failed'>();
  for (const r of resolutions) {
    if (r.status === 'fulfilled' && r.value) updates.set(r.value.hash, r.value.status);
  }
  if (updates.size === 0) return arr;

  const next = arr.map((t) => (updates.has(t.hash) ? { ...t, status: updates.get(t.hash)! } : t));
  try { localStorage.setItem(keyFor(addr), JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}
