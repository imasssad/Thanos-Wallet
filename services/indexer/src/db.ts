/**
 * Postgres pool — shared by the sync loop and the HTTP handlers.
 * Schema is in services/indexer/db/lep100.sql.
 */
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Allow self-signed certs during local docker-compose dev.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', err => {
  // eslint-disable-next-line no-console
  console.error('[indexer:pg] idle client error:', err.message);
});

/** Convenience: run a query and return rows. */
export async function q<T = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

/** Run the schema bootstrap on startup. Idempotent — uses 'create table if not exists'. */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists lep100_tokens (
      chain_id bigint not null,
      contract_address text not null,
      symbol text not null,
      name text not null,
      decimals integer not null,
      total_supply numeric,
      verified boolean default false,
      source text,
      first_seen_at timestamptz default now(),
      updated_at timestamptz default now(),
      primary key (chain_id, contract_address)
    );
    create table if not exists lep100_balances (
      chain_id bigint not null,
      contract_address text not null,
      owner_address text not null,
      owner_bech32 text,
      balance numeric not null default 0,
      updated_at timestamptz default now(),
      primary key (chain_id, contract_address, owner_address)
    );
    create table if not exists lep100_allowances (
      chain_id bigint not null,
      contract_address text not null,
      owner_address text not null,
      spender_address text not null,
      amount numeric not null default 0,
      updated_at timestamptz default now(),
      primary key (chain_id, contract_address, owner_address, spender_address)
    );
    create table if not exists lep100_events (
      id bigserial primary key,
      chain_id bigint not null,
      contract_address text not null,
      event_name text not null,
      tx_hash text not null,
      block_number bigint,
      log_index integer,
      from_address text,
      to_address text,
      spender_address text,
      amount numeric,
      occurred_at timestamptz,
      unique (chain_id, tx_hash, log_index)
    );
    create index if not exists lep100_events_from_idx on lep100_events (chain_id, from_address);
    create index if not exists lep100_events_to_idx   on lep100_events (chain_id, to_address);
    create table if not exists lep100_sync_jobs (
      id text primary key,
      chain_id bigint not null,
      mode text not null,
      status text not null,
      cursor text,
      tokens_discovered integer default 0,
      events_indexed integer default 0,
      started_at timestamptz not null,
      updated_at timestamptz not null
    );
  `);
}
