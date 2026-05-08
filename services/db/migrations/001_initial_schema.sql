-- Migration: 001_initial_schema
-- Created: 2026-04-30
-- Description: Full initial schema for Thanos Wallet production database

-- This migration applies the full schema.sql content in a versioned manner.
-- Run via: psql $DATABASE_URL -f migrations/001_initial_schema.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guard: skip if already applied
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '001_initial_schema') THEN
    RAISE NOTICE 'Migration 001_initial_schema already applied, skipping.';
    RETURN;
  END IF;
END $$;

-- Run the full schema (idempotent — uses CREATE TABLE IF NOT EXISTS throughout)
\i ../schema.sql

-- Mark as applied
INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;
