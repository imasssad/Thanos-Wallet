/**
 * Optimistic local activity log (desktop).
 *
 * The indexer only sees LEP100 Transfer events on Makalu, so native LITHO and
 * external-chain sends never appear in the Activity feed. We record every
 * successful send locally (keyed by the wallet's EVM address) and the
 * portfolio hook merges it in, deduped against the indexer by tx hash so a
 * LEP100 send doesn't show twice once the indexer catches up.
 */
export interface LocalTx {
  hash:   string;
  chain:  string;
  sym:    string;
  amount: string;
  ts:     number; // epoch ms
}

const keyFor = (addr: string) => `thanos-local-activity:${(addr || '').toLowerCase()}`;
const MAX = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — a dropped/failed tx never lingers past this

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
    localStorage.setItem(keyFor(addr), JSON.stringify([tx, ...arr].slice(0, MAX)));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
