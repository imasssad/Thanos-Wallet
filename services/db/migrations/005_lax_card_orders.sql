-- Migration: 005_lax_card_orders
-- Description: user-paid LAX virtual-card orders (Zypto create-card-order-api).
-- The user pays on Zypto's checkout; the card is issued afterwards and the
-- webhook (order_id + card_number) links it to the ordering user via this table.
-- Run via: psql $DATABASE_URL -f migrations/005_lax_card_orders.sql

CREATE TABLE IF NOT EXISTS lax_card_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id        TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'issue',   -- 'issue' | 'refill'
  card_number     TEXT,
  email           TEXT,
  amount          NUMERIC,
  currency        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS lax_card_orders_user_id_idx ON lax_card_orders(user_id);

DROP TRIGGER IF EXISTS trg_lax_card_orders_updated_at ON lax_card_orders;
CREATE TRIGGER trg_lax_card_orders_updated_at
  BEFORE UPDATE ON lax_card_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO schema_migrations (version) VALUES ('005_lax_card_orders')
ON CONFLICT (version) DO NOTHING;
