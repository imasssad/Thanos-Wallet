-- Migration: 002_lax_cards
-- Created: 2026-09-09
-- Description: lax_cards table — maps LAX/Zypto virtual card numbers to the
-- Thanos user who owns them. LAX's API is scoped to our single merchant API
-- key, not per end-user, so without this a request naming any card number
-- (query balance, top up) had no check that the card belonged to the caller.
-- Written at issuance (POST /lax/card/issue), read on every
-- /card/:cardNumber/* call — see services/api/src/routes/lax.ts.
-- Run via: psql $DATABASE_URL -f migrations/002_lax_cards.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guard: skip if already applied (matches 001_initial_schema's pattern).
-- The DDL below is also independently idempotent (IF NOT EXISTS
-- throughout), so re-running this file is safe either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '002_lax_cards') THEN
    RAISE NOTICE 'Migration 002_lax_cards already applied, skipping.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lax_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_number     TEXT NOT NULL,
  currency        TEXT,
  issued_amount   NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lax_cards_user_id_idx ON lax_cards(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS lax_cards_card_number_idx ON lax_cards(card_number);

DROP TRIGGER IF EXISTS trg_lax_cards_updated_at ON lax_cards;
CREATE TRIGGER trg_lax_cards_updated_at
  BEFORE UPDATE ON lax_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Mark as applied
INSERT INTO schema_migrations (version) VALUES ('002_lax_cards')
ON CONFLICT (version) DO NOTHING;
