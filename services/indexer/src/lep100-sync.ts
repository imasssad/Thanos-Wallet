/**
 * LEP-100 sync — REAL implementation.
 *
 * For each configured Makalu token:
 *   1. Ensure metadata is in lep100_tokens (one-time name/symbol/decimals call)
 *   2. Read the last block we processed from lep100_sync_jobs (per chain)
 *   3. Fetch Transfer events in MAX_BLOCKS_PER_BATCH chunks via eth_getLogs
 *   4. For each event: insert into lep100_events and mutate lep100_balances
 *   5. Advance the cursor
 *
 * Runs in-process via startBackgroundSync(intervalMs). Cheap enough for one
 * VPS today (one provider, ~10 tokens, polling every 15s). If load grows
 * past that, move into the existing BullMQ worker.
 */
import { Log } from 'ethers';
import { ensureSchema, pool, q } from './db.js';
import {
  MAKALU_CHAIN_ID,
  makaluProvider,
  getConfiguredTokens,
  tokenContract,
  ZERO_ADDRESS,
  type TokenSpec,
} from './chain.js';
import { setSyncMetrics } from './lib/metrics.js';
import { notifyReceive } from './push.js';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak('Transfer(address,address,uint256)')

const MAX_BLOCKS_PER_BATCH = Number(process.env.INDEXER_MAX_BLOCKS_PER_BATCH || 2_000);
const BACKGROUND_INTERVAL_MS = Number(process.env.INDEXER_INTERVAL_MS || 15_000);
const SYNC_JOB_ID = 'makalu-lep100-incremental';

/* ─── Token metadata ─────────────────────────────────────────────────── */

async function ensureToken(spec: TokenSpec): Promise<void> {
  const rows = await q(
    `select 1 from lep100_tokens where chain_id = $1 and contract_address = $2`,
    [spec.chainId, spec.address],
  );
  if (rows.length > 0) return;

  let symbol = spec.fallbackSymbol ?? 'UNKNOWN';
  let name = symbol;
  let decimals = 18;
  let totalSupply: bigint | null = null;
  try {
    const c = tokenContract(spec.address);
    const [sym, nm, dec, ts] = await Promise.all([
      c.symbol().catch(() => spec.fallbackSymbol ?? 'UNKNOWN'),
      c.name().catch(() => spec.fallbackSymbol ?? 'UNKNOWN'),
      c.decimals().catch(() => 18),
      c.totalSupply().catch(() => null) as Promise<bigint | null>,
    ]);
    symbol = String(sym);
    name = String(nm);
    decimals = Number(dec);
    totalSupply = ts;
  } catch (e) {
    // Use the fallback symbol; metadata will be retried on the next sync pass
    // when the row is missing.
    // eslint-disable-next-line no-console
    console.warn(`[indexer] metadata read failed for ${spec.address}:`, (e as Error).message);
  }

  await pool.query(
    `insert into lep100_tokens
       (chain_id, contract_address, symbol, name, decimals, total_supply, source)
     values ($1, $2, $3, $4, $5, $6, 'env')
     on conflict (chain_id, contract_address) do update
       set symbol = excluded.symbol,
           name   = excluded.name,
           decimals = excluded.decimals,
           total_supply = excluded.total_supply,
           updated_at = now()`,
    [spec.chainId, spec.address, symbol, name, decimals, totalSupply?.toString() ?? null],
  );
}

/* ─── Cursor management ──────────────────────────────────────────────── */

async function getCursor(): Promise<number> {
  const rows = await q<{ cursor: string | null }>(
    `select cursor from lep100_sync_jobs where id = $1`,
    [SYNC_JOB_ID],
  );
  if (!rows.length || !rows[0].cursor) return -1;
  return Number(rows[0].cursor);
}

async function setCursor(blockNumber: number, eventsCount: number): Promise<void> {
  await pool.query(
    `insert into lep100_sync_jobs (id, chain_id, mode, status, cursor, events_indexed, started_at, updated_at)
     values ($1, $2, 'incremental', 'running', $3, $4, now(), now())
     on conflict (id) do update
       set cursor = excluded.cursor,
           events_indexed = lep100_sync_jobs.events_indexed + excluded.events_indexed,
           status = 'running',
           updated_at = now()`,
    [SYNC_JOB_ID, MAKALU_CHAIN_ID, String(blockNumber), eventsCount],
  );
}

/* ─── Event processing ───────────────────────────────────────────────── */

function topicToAddress(topic: string): string {
  // topic is 32-byte hex; the 20-byte address is the last 40 hex chars.
  return ('0x' + topic.slice(26)).toLowerCase();
}

/** Exported for integration tests — exercises the SQL-side balance
 *  mutation + idempotency in isolation. Production callers should reach
 *  through syncRange / runMakaluSync instead. */
export async function processTransferLog(log: Log, blockTimestamp: Date, symbol = 'tokens'): Promise<void> {
  const fromAddr = topicToAddress(log.topics[1]);
  const toAddr   = topicToAddress(log.topics[2]);
  const value    = BigInt(log.data || '0x0').toString();
  const contract = log.address.toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('begin');

    const eventRows = await client.query(
      `insert into lep100_events
         (chain_id, contract_address, event_name, tx_hash, block_number, log_index,
          from_address, to_address, amount, occurred_at)
       values ($1, $2, 'Transfer', $3, $4, $5, $6, $7, $8, $9)
       on conflict (chain_id, tx_hash, log_index) do nothing
       returning id`,
      [
        MAKALU_CHAIN_ID,
        contract,
        log.transactionHash,
        log.blockNumber,
        log.index,
        fromAddr,
        toAddr,
        value,
        blockTimestamp.toISOString(),
      ],
    );
    if (eventRows.rowCount === 0) {
      // Duplicate (reorg / retry) — balances already mutated, skip.
      await client.query('commit');
      return;
    }

    // Mutate balances. Mint (from == 0x0) only increments destination;
    // burn (to == 0x0) only decrements source; normal transfer does both.
    if (fromAddr !== ZERO_ADDRESS.toLowerCase()) {
      await client.query(
        `insert into lep100_balances (chain_id, contract_address, owner_address, balance, updated_at)
         values ($1, $2, $3, 0, now())
         on conflict (chain_id, contract_address, owner_address) do nothing`,
        [MAKALU_CHAIN_ID, contract, fromAddr],
      );
      await client.query(
        `update lep100_balances set balance = balance - $4::numeric, updated_at = now()
         where chain_id = $1 and contract_address = $2 and owner_address = $3`,
        [MAKALU_CHAIN_ID, contract, fromAddr, value],
      );
    }
    if (toAddr !== ZERO_ADDRESS.toLowerCase()) {
      await client.query(
        `insert into lep100_balances (chain_id, contract_address, owner_address, balance, updated_at)
         values ($1, $2, $3, $4::numeric, now())
         on conflict (chain_id, contract_address, owner_address) do update
           set balance = lep100_balances.balance + excluded.balance,
               updated_at = now()`,
        [MAKALU_CHAIN_ID, contract, toAddr, value],
      );
    }

    await client.query('commit');

    // New incoming transfer → push the recipient's devices (best-effort).
    if (toAddr !== ZERO_ADDRESS.toLowerCase()) {
      notifyReceive(toAddr, symbol, log.transactionHash);
    }
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/* ─── Sync passes ────────────────────────────────────────────────────── */

async function syncRange(fromBlock: number, toBlock: number, tokens: TokenSpec[]): Promise<number> {
  if (toBlock < fromBlock) return 0;
  const addresses = tokens.map(t => t.address);
  const logs = await makaluProvider.getLogs({
    fromBlock,
    toBlock,
    address: addresses,
    topics:  [TRANSFER_TOPIC],
  });
  if (logs.length === 0) return 0;

  // Group logs by block so we only fetch each timestamp once.
  const blockTimes = new Map<number, Date>();
  for (const log of logs) {
    if (log.blockNumber == null) continue;
    if (!blockTimes.has(log.blockNumber)) {
      const block = await makaluProvider.getBlock(log.blockNumber);
      blockTimes.set(log.blockNumber, new Date((block?.timestamp ?? 0) * 1000));
    }
  }

  const symbolByAddr = new Map(tokens.map(t => [t.address.toLowerCase(), t.fallbackSymbol ?? 'tokens']));
  for (const log of logs) {
    const ts = log.blockNumber != null ? (blockTimes.get(log.blockNumber) ?? new Date()) : new Date();
    await processTransferLog(log, ts, symbolByAddr.get(log.address.toLowerCase()) ?? 'tokens');
  }
  return logs.length;
}

/** Idempotent: safe to call repeatedly. Advances the cursor by up to one
 *  batch of MAX_BLOCKS_PER_BATCH per invocation. */
export async function runMakaluSync(mode: 'bootstrap' | 'incremental' | 'backfill' = 'incremental') {
  const startedAt = new Date().toISOString();
  const tokens = getConfiguredTokens();
  if (tokens.length === 0) {
    return { ok: true, processed: 0, message: 'No tokens configured', startedAt };
  }

  await Promise.all(tokens.map(ensureToken));

  const head = await makaluProvider.getBlockNumber();
  let cursor = await getCursor();
  if (mode === 'backfill') {
    // Full re-scan from genesis — ALSO when a cursor already exists.
    // This is required whenever the watched contract set changes (e.g.
    // the 2026-06 corrected token addresses): the global cursor has
    // already advanced past the blocks holding the new contracts'
    // historical Transfer events, so incremental sync would never see
    // them and balances would stay empty forever. Event processing is
    // idempotent (upserts), so re-scanning ranges we've seen is safe.
    cursor = -1;
  } else if (cursor < 0) {
    // Cold start: only index forward from current head.
    cursor = head - 1;
  }

  let processed = 0;
  let from = cursor + 1;
  while (from <= head) {
    const to = Math.min(from + MAX_BLOCKS_PER_BATCH - 1, head);
    // Retry each batch with exponential backoff. A full backfill is
    // ~2,900 batches against upstream nginx that 502s for a few seconds
    // now and then (observed live 2026-06-12) — without retries one
    // blip aborts the whole multi-hour run; the cursor makes re-runs
    // safe but losing 20 minutes of progress to a 2-second 502 is silly.
    let n = 0;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { n = await syncRange(from, to, tokens); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 1_000 * 2 ** attempt));
      }
    }
    if (lastErr) throw lastErr;
    processed += n;
    await setCursor(to, n);
    from = to + 1;
    // Single-batch-per-tick to keep the event loop responsive.
    if (mode === 'incremental') break;
  }

  const cursorAfter = Math.min(from - 1, head);
  setSyncMetrics({ head, cursor: cursorAfter, eventsThisPass: processed });
  return {
    ok: true,
    processed,
    headBlock: head,
    cursorAfter,
    tokens: tokens.length,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/* ─── Background loop ────────────────────────────────────────────────── */

let _bgTimer: NodeJS.Timeout | null = null;

export function startBackgroundSync(intervalMs = BACKGROUND_INTERVAL_MS): void {
  if (_bgTimer) return;
  const tick = async () => {
    try { await runMakaluSync('incremental'); }
    catch (e) { console.warn('[indexer:sync] tick failed:', (e as Error).message); }
  };
  // Fire one immediately, then on the interval.
  tick();
  _bgTimer = setInterval(tick, intervalMs);
  console.log(`[indexer:sync] background poll every ${intervalMs}ms`);
}

export function stopBackgroundSync(): void {
  if (_bgTimer) { clearInterval(_bgTimer); _bgTimer = null; }
}

/* ─── Re-exports the old server.ts expects ───────────────────────────── */

export interface ResolvedMakaluToken {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

/** Replaced the seed-token stub with a DB read. Returns whatever's in
 *  lep100_tokens so /lep100/tokens reflects what the sync has discovered. */
export async function getMakaluSeedTokenList() {
  const rows = await q<{ symbol: string; name: string; decimals: number; contract_address: string }>(
    `select symbol, name, decimals, contract_address from lep100_tokens
     where chain_id = $1 order by symbol`,
    [MAKALU_CHAIN_ID],
  );
  return {
    items: rows.map(r => ({
      symbol: r.symbol,
      name: r.name,
      decimals: r.decimals,
      contractAddress: r.contract_address,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildSeedActivity(walletAddress: string) {
  const lower = walletAddress.toLowerCase();
  const rows = await q<{
    id: string; tx_hash: string; block_number: string;
    from_address: string; to_address: string; amount: string;
    occurred_at: string; symbol: string;
  }>(
    `select e.id, e.tx_hash, e.block_number, e.from_address, e.to_address,
            e.amount, e.occurred_at, t.symbol
       from lep100_events e
       join lep100_tokens t on t.chain_id = e.chain_id
                          and t.contract_address = e.contract_address
      where e.chain_id = $1
        and (e.from_address = $2 or e.to_address = $2)
      order by e.block_number desc, e.log_index desc
      limit 50`,
    [MAKALU_CHAIN_ID, lower],
  );
  return rows.map(r => {
    const isReceive = r.to_address === lower;
    return {
      id: String(r.id),
      chainId: MAKALU_CHAIN_ID,
      kind: isReceive ? 'receive' : 'send',
      status: 'confirmed',
      title: `${isReceive ? 'Received' : 'Sent'} ${r.symbol}`,
      amount: r.amount,
      symbol: r.symbol,
      txHash: r.tx_hash,
      createdAt: r.occurred_at,
    };
  });
}

export const seededApprovals: Array<unknown> = [];

/** New: balances for an address, joined with token metadata. */
export async function getBalancesFor(walletAddress: string) {
  const lower = walletAddress.toLowerCase();
  const rows = await q<{
    contract_address: string; balance: string; symbol: string;
    name: string; decimals: number;
  }>(
    `select b.contract_address, b.balance, t.symbol, t.name, t.decimals
       from lep100_balances b
       join lep100_tokens t on t.chain_id = b.chain_id
                          and t.contract_address = b.contract_address
      where b.chain_id = $1 and b.owner_address = $2
      order by t.symbol`,
    [MAKALU_CHAIN_ID, lower],
  );
  return rows.map(r => ({
    chainId: MAKALU_CHAIN_ID,
    contractAddress: r.contract_address,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    balance: r.balance,
  }));
}

/** Native LITHO balance (no contract — uses provider.getBalance). */
export async function getNativeLithoBalance(walletAddress: string): Promise<string> {
  const wei = await makaluProvider.getBalance(walletAddress);
  return wei.toString();
}

export { ensureSchema };
