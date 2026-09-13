-- Migration: 003_lax_webhook_events
-- Created: 2026-09-13
-- Description: lax_webhook_events table — raw log of every inbound LAX/
-- Zypto webhook call. Their webhook event names/payload shapes are
-- dashboard-configured, not documented in the OpenAPI spec (Robert:
-- "following the same naming convention as your product or the general
-- term, such as 'user deposit'"), and there's no confirmed signature
-- scheme to verify authenticity with yet — so this table exists to
-- capture every payload as-received for reconciliation/debugging rather
-- than silently dropping or guessing at a shape. See
-- services/api/src/routes/lax.ts's laxWebhookRouter.
-- Run via: psql $DATABASE_URL -f migrations/003_lax_webhook_events.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '003_lax_webhook_events') THEN
    RAISE NOTICE 'Migration 003_lax_webhook_events already applied, skipping.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lax_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT,
  card_number   TEXT,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lax_webhook_events_card_number_idx ON lax_webhook_events(card_number);
CREATE INDEX IF NOT EXISTS lax_webhook_events_received_at_idx ON lax_webhook_events(received_at DESC);

INSERT INTO schema_migrations (version) VALUES ('003_lax_webhook_events')
ON CONFLICT (version) DO NOTHING;
