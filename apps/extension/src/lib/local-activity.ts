/**
 * Optimistic local activity log.
 *
 * The indexer only sees LEP100 Transfer events on Makalu, so native LITHO
 * sends and external-chain sends never show up in the Activity feed — a user
 * sends a tx and nothing appears. We record every successful send locally
 * (keyed by the wallet's EVM address) and the portfolio hook merges it into
 * the feed, deduped against the indexer by tx hash so a LEP100 send doesn't
 * appear twice once the indexer catches up.
 */
export interface LocalTx {
  hash:   string;
  chain:  string;
  sym:    string;
  label:  'Sent';
  amount: string;
  ts:     number; // epoch ms
}

const keyFor = (addr: string) => `thanos-local-activity:${(addr || '').toLowerCase()}`;
const MAX = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — drop stale optimistic rows

export function getLocalActivity(addr: string): LocalTx[] {
  if (!addr || typeof localStorage === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(keyFor(addr)) || '[]');
    if (!Array.isArray(arr)) return [];
    // Expire entries older than 24h on read, so a dropped/failed tx that the
    // indexer never reports doesn't linger as a "Pending" row forever.
    const cutoff = Date.now() - MAX_AGE_MS;
    const fresh = (arr as LocalTx[]).filter((t) => Number(t?.ts) >= cutoff);
    if (fresh.length !== arr.length) {
      try { localStorage.setItem(keyFor(addr), JSON.stringify(fresh)); } catch { /* non-fatal */ }
    }
    return fresh;
  } catch {
    return [];
  }
}

export function addLocalActivity(addr: string, tx: LocalTx): void {
  if (!addr || !tx.hash || typeof localStorage === 'undefined') return;
  try {
    const arr = getLocalActivity(addr);
    if (arr.some((t) => t.hash === tx.hash)) return; // already recorded
    localStorage.setItem(keyFor(addr), JSON.stringify([tx, ...arr].slice(0, MAX)));
  } catch {
    /* quota exceeded / storage disabled — non-fatal, just skip the optimistic entry */
  }
}
