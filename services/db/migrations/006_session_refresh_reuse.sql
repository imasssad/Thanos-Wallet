-- Migration: 006_session_refresh_reuse
-- Created: 2026-11-03
-- Description: THN-06 (Autha THN-R1) — refresh-token rotation (auth.ts
-- POST /auth/refresh) had no way to tell "this token was never valid" apart
-- from "this token WAS valid but has since been rotated past" — both read
-- back as a plain 401, so a stolen refresh token presented after the
-- legitimate client already rotated past it went unnoticed instead of
-- revoking the session. previous_refresh_token stores the hash each
-- rotation just superseded, so a later request presenting exactly that hash
-- is recognizable as reuse and the session is revoked outright.
-- Run via: psql $DATABASE_URL -f migrations/006_session_refresh_reuse.sql

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS previous_refresh_token TEXT;

CREATE INDEX IF NOT EXISTS sessions_previous_refresh_token_idx ON sessions(previous_refresh_token);

INSERT INTO schema_migrations (version) VALUES ('006_session_refresh_reuse')
ON CONFLICT (version) DO NOTHING;
