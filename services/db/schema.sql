-- =============================================================================
-- THANOS WALLET — FULL POSTGRES SCHEMA
-- Version: 1.0.0
-- Run this on a fresh database. For existing DBs use migrations/ instead.
-- =============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- 1. USERS & SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE,
  password_hash   TEXT,                        -- Argon2id hash, NULL for wallet-sig auth
  display_name    TEXT,
  avatar_url      TEXT,
  mfa_secret      TEXT,                        -- TOTP secret, encrypted at app layer
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name     TEXT,
  platform        TEXT,                        -- 'web' | 'ios' | 'android' | 'desktop' | 'extension'
  fingerprint     TEXT,
  user_agent      TEXT,                        -- captured by auth.ts on register/login
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent fix for clusters that initialised against the older schema
-- (pre-2026-05): add the user_agent column if missing. ALTER ADD COLUMN
-- IF NOT EXISTS landed in Postgres 9.6, so safe on every supported version.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  refresh_token   TEXT NOT NULL UNIQUE,        -- hashed before storage
  ip_address      TEXT,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx  ON sessions(expires_at);

-- Auth audit trail
CREATE TABLE IF NOT EXISTS auth_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,               -- 'login' | 'logout' | 'failed_login' | 'password_change' | 'mfa_enabled'
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_events_user_id_idx ON auth_events(user_id);
CREATE INDEX IF NOT EXISTS auth_events_occurred_idx ON auth_events(occurred_at DESC);

-- =============================================================================
-- 2. WALLETS & ACCOUNTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'My Wallet',
  wallet_type     TEXT NOT NULL DEFAULT 'hd',  -- 'hd' | 'imported' | 'hardware' | 'watch'
  encrypted_vault TEXT,                        -- client-side encrypted, stored for multi-device sync
  vault_hint      TEXT,                        -- non-sensitive hint for vault version/format
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallets_user_id_idx ON wallets(user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'Account 1',
  chain_kind      TEXT NOT NULL,               -- 'evm' | 'lithic' | 'bitcoin' | 'solana'
  network_id      TEXT NOT NULL,
  chain_id        BIGINT NOT NULL,
  address         TEXT NOT NULL,               -- canonical 0x format for EVM/Lithic
  address_bech32  TEXT,                        -- litho1... for Lithosphere accounts
  derivation_path TEXT,
  public_key      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_chain_address_idx ON accounts(chain_id, address);
CREATE INDEX IF NOT EXISTS accounts_wallet_id_idx ON accounts(wallet_id);
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

-- =============================================================================
-- 3. TRANSACTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  chain_kind      TEXT NOT NULL,
  chain_id        BIGINT NOT NULL,
  tx_hash         TEXT,
  block_number    BIGINT,
  tx_type         TEXT NOT NULL,               -- 'send' | 'receive' | 'swap' | 'bridge' | 'contract' | 'lep100' | 'dnns'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'failed' | 'dropped'
  from_address    TEXT,
  to_address      TEXT,
  amount          NUMERIC,
  fee             NUMERIC,
  token_address   TEXT,
  token_symbol    TEXT,
  token_decimals  INTEGER,
  memo            TEXT,
  raw_data        JSONB,                       -- full chain-specific tx payload
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_hash_chain_idx ON transactions(chain_id, tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_account_id_idx ON transactions(account_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions(user_id);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);
CREATE INDEX IF NOT EXISTS transactions_created_idx ON transactions(created_at DESC);

-- =============================================================================
-- 4. CONTACTS / ADDRESS BOOK
-- =============================================================================

CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL,               -- 0x or litho1 or BTC/SOL address
  address_type    TEXT,                        -- 'evm' | 'litho' | 'bitcoin' | 'solana'
  chain_id        BIGINT,
  notes           TEXT,
  is_favourite    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_address_idx ON contacts(user_id, address);

-- =============================================================================
-- 5. WALLETCONNECT SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS wc_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           TEXT NOT NULL UNIQUE,        -- WalletConnect session topic
  peer_name       TEXT,
  peer_url        TEXT,
  peer_icon       TEXT,
  chain_ids       BIGINT[] NOT NULL DEFAULT '{}',
  methods         TEXT[] NOT NULL DEFAULT '{}',
  accounts        TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wc_sessions_user_id_idx ON wc_sessions(user_id);
CREATE INDEX IF NOT EXISTS wc_sessions_topic_idx ON wc_sessions(topic);

-- Pending WC requests awaiting user approval
CREATE TABLE IF NOT EXISTS wc_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES wc_sessions(id) ON DELETE CASCADE,
  request_id      TEXT NOT NULL,               -- WC request ID
  method          TEXT NOT NULL,
  params          JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'expired'
  result          JSONB,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS wc_requests_session_id_idx ON wc_requests(session_id);

-- =============================================================================
-- 6. TOKENS
-- =============================================================================

CREATE TABLE IF NOT EXISTS tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id        BIGINT NOT NULL,
  address         TEXT NOT NULL,               -- contract address
  symbol          TEXT NOT NULL,
  name            TEXT NOT NULL,
  decimals        INTEGER NOT NULL DEFAULT 18,
  standard        TEXT NOT NULL DEFAULT 'erc20', -- 'erc20' | 'lep100' | 'spl' | 'native'
  logo_url        TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  coingecko_id    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tokens_chain_address_idx ON tokens(chain_id, address);

-- User-imported custom tokens
CREATE TABLE IF NOT EXISTS user_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id        UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  is_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_tokens_user_token_idx ON user_tokens(user_id, token_id);

-- =============================================================================
-- 7. PORTFOLIO SNAPSHOTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL,
  total_usd       NUMERIC,
  assets          JSONB NOT NULL DEFAULT '[]',
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_idx ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_taken_idx ON portfolio_snapshots(taken_at DESC);

-- =============================================================================
-- 8. BRIDGE JOBS
-- =============================================================================

CREATE TABLE IF NOT EXISTS bridge_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  execution_id    TEXT NOT NULL UNIQUE,        -- MultX execution ID
  provider        TEXT NOT NULL DEFAULT 'multx',
  status          TEXT NOT NULL DEFAULT 'submitted', -- 'quoted'|'submitted'|'bridging'|'settling'|'completed'|'failed'
  from_chain_id   BIGINT NOT NULL,
  to_chain_id     BIGINT NOT NULL,
  from_token      TEXT NOT NULL,
  to_token        TEXT NOT NULL,
  amount_in       NUMERIC,
  amount_out      NUMERIC,
  source_tx_hash  TEXT,
  dest_tx_hash    TEXT,
  failure_reason  TEXT,
  raw_status      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bridge_jobs_user_id_idx ON bridge_jobs(user_id);
CREATE INDEX IF NOT EXISTS bridge_jobs_status_idx ON bridge_jobs(status);

-- =============================================================================
-- 9. DNNS (Decentralised Name Service)
-- =============================================================================

CREATE TABLE IF NOT EXISTS dnns_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,               -- e.g. alice.litho
  chain_id        BIGINT NOT NULL,
  address         TEXT NOT NULL,               -- resolved 0x address
  address_bech32  TEXT,                        -- resolved litho1 address
  resolver        TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS dnns_cache_name_chain_idx ON dnns_cache(name, chain_id);

-- =============================================================================
-- 10. LEP100 TABLES (extended from indexer/db/lep100.sql)
-- =============================================================================

CREATE TABLE IF NOT EXISTS lep100_tokens (
  chain_id        BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  name            TEXT NOT NULL,
  decimals        INTEGER NOT NULL,
  total_supply    NUMERIC,
  verified        BOOLEAN DEFAULT FALSE,
  source          TEXT,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS lep100_balances (
  chain_id        BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_address   TEXT NOT NULL,               -- canonical 0x
  owner_bech32    TEXT,                        -- litho1... mirror
  balance         NUMERIC NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, owner_address)
);

CREATE TABLE IF NOT EXISTS lep100_allowances (
  chain_id        BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_address   TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  amount          NUMERIC NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, owner_address, spender_address)
);

CREATE TABLE IF NOT EXISTS lep100_events (
  id              BIGSERIAL PRIMARY KEY,
  chain_id        BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  block_number    BIGINT,
  log_index       INTEGER,
  from_address    TEXT,
  to_address      TEXT,
  spender_address TEXT,
  amount          NUMERIC,
  occurred_at     TIMESTAMPTZ,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS lep100_events_contract_idx ON lep100_events(chain_id, contract_address);
CREATE INDEX IF NOT EXISTS lep100_events_block_idx ON lep100_events(block_number DESC);

CREATE TABLE IF NOT EXISTS lep100_sync_jobs (
  id              TEXT PRIMARY KEY,
  chain_id        BIGINT NOT NULL,
  mode            TEXT NOT NULL,               -- 'bootstrap' | 'incremental' | 'backfill'
  status          TEXT NOT NULL,               -- 'queued' | 'running' | 'completed' | 'failed'
  cursor          TEXT,                        -- last synced block number
  tokens_discovered INTEGER DEFAULT 0,
  events_indexed  INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- 11. JOB QUEUE STATE (mirrors BullMQ, for audit/recovery)
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name      TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  status          TEXT NOT NULL,               -- 'queued' | 'active' | 'completed' | 'failed' | 'delayed'
  payload         JSONB,
  result          JSONB,
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_audit_queue_idx ON job_audit(queue_name, status);

-- Push notification device tokens (Expo). Keyed by wallet address so the
-- indexer can fan out alerts on incoming activity. No FK to users — the
-- mobile wallet is local-first and registers without a session.
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_tokens_address_idx ON push_tokens(LOWER(address));

-- =============================================================================
-- 12. UPDATED_AT AUTO-TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','wallets','accounts','transactions','contacts',
    'wc_sessions','wc_requests','tokens','portfolio_snapshots',
    'bridge_jobs','lep100_tokens','lep100_balances','lep100_allowances','job_audit',
    'push_tokens'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;
       CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      t, t, t, t
    );
  END LOOP;
END;
$$;
