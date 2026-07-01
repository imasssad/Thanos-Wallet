/**
 * LEP100 indexer integration test — real Postgres, synthetic chain logs.
 *
 * Boots the schema, then feeds synthetic Transfer logs through
 * `processTransferLog` to verify the SQL-side behaviour:
 *   - mint   (from = 0x00) credits only the recipient
 *   - normal transfer debits the sender + credits the recipient
 *   - burn   (to = 0x00) debits only the sender
 *   - duplicate log is a no-op (idempotency via the (chain_id, tx_hash,
 *     log_index) unique constraint)
 *   - balance sums match the event sum
 *
 * Skipped when DATABASE_URL is unset, so `pnpm test` locally still
 * passes without a DB.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Log } from 'ethers';

const haveDb = !!process.env.DATABASE_URL;
const describeIfDb = haveDb ? describe : describe.skip;

const MAKALU_CHAIN_ID = 700777;
const ZERO            = '0x0000000000000000000000000000000000000000';
const TOKEN           = '0xc47e49259b8dda2c9d57941e1a52747e4c721cb9'; // arbitrary fixture
const ALICE           = '0xa11ce00000000000000000000000000000000a11';
const BOB             = '0xb0b0000000000000000000000000000000000b0b';

let pool: Pool;
// Imported lazily so the test file can be loaded (for skip-discovery)
// even on machines that don't have a DATABASE_URL — the indexer's
// chain.ts assumes RPC env vars present at import time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processTransferLog: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let batchProcessTransferLogs: any;

/** Pad an EVM address to a 32-byte hex topic. */
function addrTopic(addr: string): string {
  return '0x' + addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');
}

/** Build a synthetic Transfer log. The real one from ethers has more
 *  fields; we only populate what processTransferLog reads. */
function makeTransferLog(args: {
  from:        string;
  to:          string;
  valueWei:    bigint;
  blockNumber: number;
  logIndex:    number;
  txHash:      string;
}): Log {
  // Use a unique-enough txHash per call so the (chain_id, tx_hash, log_index)
  // index doesn't collide unless the caller deliberately re-submits the same.
  return {
    address:     TOKEN,
    blockHash:   '0x' + 'd'.repeat(64),
    blockNumber: args.blockNumber,
    data:        '0x' + args.valueWei.toString(16).padStart(64, '0'),
    index:       args.logIndex,
    removed:     false,
    topics:      [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      addrTopic(args.from),
      addrTopic(args.to),
    ],
    transactionHash:  args.txHash,
    transactionIndex: 0,
  } as unknown as Log;
}

beforeAll(async () => {
  if (!haveDb) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Load the canonical schema.
  const schemaPath = join(process.cwd(), '..', 'db', 'schema.sql');
  const schemaSql  = await readFile(schemaPath, 'utf-8');
  await pool.query(schemaSql);

  // Seed the token row that processTransferLog assumes exists (via
  // ON CONFLICT DO NOTHING — but the balance-insert path needs the
  // FK target present).
  await pool.query(
    `insert into lep100_tokens
       (chain_id, contract_address, symbol, name, decimals, source)
     values ($1, $2, 'TST', 'Test', 18, 'env')
     on conflict (chain_id, contract_address) do nothing`,
    [MAKALU_CHAIN_ID, TOKEN],
  );

  // Lazy-import the sync module so it doesn't run RPC bootstrap at
  // file load. We deliberately don't import the whole indexer entrypoint.
  const mod = await import('../lep100-sync.js');
  processTransferLog = mod.processTransferLog;
  batchProcessTransferLogs = mod.batchProcessTransferLogs;
});

beforeEach(async () => {
  if (!haveDb) return;
  // Reset rows that affect balance arithmetic — keep the token row.
  await pool.query(`delete from lep100_events where contract_address = $1`, [TOKEN]);
  await pool.query(`delete from lep100_balances where contract_address = $1`, [TOKEN]);
});

afterAll(async () => {
  if (!haveDb) return;
  await pool.end();
});

async function balanceOf(addr: string): Promise<bigint> {
  const r = await pool.query(
    `select balance from lep100_balances where chain_id = $1 and contract_address = $2 and owner_address = $3`,
    [MAKALU_CHAIN_ID, TOKEN, addr.toLowerCase()],
  );
  return r.rows[0] ? BigInt(r.rows[0].balance) : 0n;
}

async function eventCount(): Promise<number> {
  const r = await pool.query(
    `select count(*)::int as n from lep100_events where contract_address = $1`,
    [TOKEN],
  );
  return r.rows[0]?.n ?? 0;
}

describeIfDb('processTransferLog — real Postgres', () => {
  it('mint credits only the recipient (no sender debit)', async () => {
    await processTransferLog(
      makeTransferLog({ from: ZERO, to: ALICE, valueWei: 100n, blockNumber: 1, logIndex: 0, txHash: '0x' + '1'.repeat(64) }),
      new Date('2026-05-23T12:00:00Z'),
    );
    expect(await balanceOf(ALICE)).toBe(100n);
    // No balance row for the zero address — minting source is implicit.
    expect(await balanceOf(ZERO)).toBe(0n);
    expect(await eventCount()).toBe(1);
  });

  it('normal transfer debits sender + credits recipient', async () => {
    await processTransferLog(
      makeTransferLog({ from: ZERO, to: ALICE, valueWei: 100n, blockNumber: 1, logIndex: 0, txHash: '0x' + '1'.repeat(64) }),
      new Date('2026-05-23T12:00:00Z'),
    );
    await processTransferLog(
      makeTransferLog({ from: ALICE, to: BOB, valueWei: 30n, blockNumber: 2, logIndex: 0, txHash: '0x' + '2'.repeat(64) }),
      new Date('2026-05-23T12:01:00Z'),
    );
    expect(await balanceOf(ALICE)).toBe(70n);
    expect(await balanceOf(BOB)).toBe(30n);
    expect(await eventCount()).toBe(2);
  });

  it('burn debits sender only', async () => {
    await processTransferLog(
      makeTransferLog({ from: ZERO, to: ALICE, valueWei: 100n, blockNumber: 1, logIndex: 0, txHash: '0x' + '1'.repeat(64) }),
      new Date('2026-05-23T12:00:00Z'),
    );
    await processTransferLog(
      makeTransferLog({ from: ALICE, to: ZERO, valueWei: 40n, blockNumber: 2, logIndex: 0, txHash: '0x' + '3'.repeat(64) }),
      new Date('2026-05-23T12:01:00Z'),
    );
    expect(await balanceOf(ALICE)).toBe(60n);
    expect(await eventCount()).toBe(2);
  });

  it('duplicate (same chain_id + tx_hash + log_index) is idempotent', async () => {
    const log = makeTransferLog({
      from: ZERO, to: ALICE, valueWei: 50n,
      blockNumber: 1, logIndex: 0, txHash: '0x' + '4'.repeat(64),
    });
    await processTransferLog(log, new Date('2026-05-23T12:00:00Z'));
    await processTransferLog(log, new Date('2026-05-23T12:00:00Z'));  // re-submit
    // Balance didn't double; only one event row exists.
    expect(await balanceOf(ALICE)).toBe(50n);
    expect(await eventCount()).toBe(1);
  });

  it('balance sum equals net events sum after several transfers', async () => {
    await processTransferLog(makeTransferLog({ from: ZERO,  to: ALICE, valueWei: 1000n, blockNumber: 1, logIndex: 0, txHash: '0x' + '5'.repeat(64) }), new Date());
    await processTransferLog(makeTransferLog({ from: ALICE, to: BOB,   valueWei:  300n, blockNumber: 2, logIndex: 0, txHash: '0x' + '6'.repeat(64) }), new Date());
    await processTransferLog(makeTransferLog({ from: ALICE, to: ZERO,  valueWei:  100n, blockNumber: 3, logIndex: 0, txHash: '0x' + '7'.repeat(64) }), new Date());
    const total = await balanceOf(ALICE) + await balanceOf(BOB);
    // Minted 1000, burned 100 → 900 net outstanding.
    expect(total).toBe(900n);
  });
});

/* Batched path (used by syncRange) — must produce identical balances to the
 * per-event path above, plus handle whole-batch idempotency and partial-overlap
 * replays where only genuinely-new events may mutate balances. */
describeIfDb('batchProcessTransferLogs — real Postgres (batched path)', () => {
  const times   = new Map<number, Date>();
  const symbols = new Map<string, string>([[TOKEN.toLowerCase(), 'TST']]);
  function batch(logs: Log[]) {
    for (const l of logs) {
      if (l.blockNumber != null && !times.has(l.blockNumber)) {
        times.set(l.blockNumber, new Date('2026-05-23T12:00:00Z'));
      }
    }
    return batchProcessTransferLogs(logs, times, symbols);
  }

  it('mint + transfer + burn in ONE batch nets correctly', async () => {
    await batch([
      makeTransferLog({ from: ZERO,  to: ALICE, valueWei: 1000n, blockNumber: 1, logIndex: 0, txHash: '0x' + 'a1'.repeat(32) }),
      makeTransferLog({ from: ALICE, to: BOB,   valueWei:  300n, blockNumber: 2, logIndex: 0, txHash: '0x' + 'a2'.repeat(32) }),
      makeTransferLog({ from: ALICE, to: ZERO,  valueWei:  100n, blockNumber: 3, logIndex: 0, txHash: '0x' + 'a3'.repeat(32) }),
    ]);
    expect(await balanceOf(ALICE)).toBe(600n);   // 1000 - 300 - 100
    expect(await balanceOf(BOB)).toBe(300n);
    expect(await balanceOf(ZERO)).toBe(0n);       // zero-address never credited/debited
    expect(await eventCount()).toBe(3);
  });

  it('matches the per-event scenario (mint→transfer→burn)', async () => {
    await batch([
      makeTransferLog({ from: ZERO,  to: ALICE, valueWei: 100n, blockNumber: 1, logIndex: 0, txHash: '0x' + 'b1'.repeat(32) }),
      makeTransferLog({ from: ALICE, to: BOB,   valueWei:  30n, blockNumber: 2, logIndex: 0, txHash: '0x' + 'b2'.repeat(32) }),
      makeTransferLog({ from: ALICE, to: ZERO,  valueWei:  40n, blockNumber: 3, logIndex: 0, txHash: '0x' + 'b3'.repeat(32) }),
    ]);
    expect(await balanceOf(ALICE)).toBe(30n);     // 100 - 30 - 40
    expect(await balanceOf(BOB)).toBe(30n);
  });

  it('re-running the same batch is idempotent (balances + events unchanged)', async () => {
    const logs = [
      makeTransferLog({ from: ZERO,  to: ALICE, valueWei: 500n, blockNumber: 1, logIndex: 0, txHash: '0x' + 'c1'.repeat(32) }),
      makeTransferLog({ from: ALICE, to: BOB,   valueWei: 200n, blockNumber: 2, logIndex: 0, txHash: '0x' + 'c2'.repeat(32) }),
    ];
    await batch(logs);
    await batch(logs);                            // replay the whole batch
    expect(await balanceOf(ALICE)).toBe(300n);
    expect(await balanceOf(BOB)).toBe(200n);
    expect(await eventCount()).toBe(2);
  });

  it('partial-overlap batch: only genuinely-new events mutate balances', async () => {
    const e1 = makeTransferLog({ from: ZERO, to: ALICE, valueWei: 100n, blockNumber: 1, logIndex: 0, txHash: '0x' + 'd1'.repeat(32) });
    await batch([e1]);
    expect(await balanceOf(ALICE)).toBe(100n);
    const e2 = makeTransferLog({ from: ALICE, to: BOB, valueWei: 25n, blockNumber: 2, logIndex: 0, txHash: '0x' + 'd2'.repeat(32) });
    await batch([e1, e2]);                        // e1 is a duplicate, e2 is new
    expect(await balanceOf(ALICE)).toBe(75n);     // 100 - 25 (e1 NOT double-counted)
    expect(await balanceOf(BOB)).toBe(25n);
    expect(await eventCount()).toBe(2);
  });
});

if (!haveDb) {
  // eslint-disable-next-line no-console
  console.log('[lep100-sync-integration] SKIPPED — DATABASE_URL not set');
}
