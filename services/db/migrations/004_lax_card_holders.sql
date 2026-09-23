-- Physical-card holder identities returned by LAX/Zypto.
-- The holder id is required by the provider KYC and issuer endpoints and must
-- never be accepted from a caller without checking ownership.
CREATE TABLE IF NOT EXISTS lax_card_holders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_id       TEXT NOT NULL,
  status          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id),
  UNIQUE (holder_id)
);

CREATE INDEX IF NOT EXISTS lax_card_holders_user_id_idx ON lax_card_holders(user_id);
CREATE INDEX IF NOT EXISTS lax_card_holders_holder_id_idx ON lax_card_holders(holder_id);

DROP TRIGGER IF EXISTS trg_lax_card_holders_updated_at ON lax_card_holders;
CREATE TRIGGER trg_lax_card_holders_updated_at
  BEFORE UPDATE ON lax_card_holders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO schema_migrations (version) VALUES ('004_lax_card_holders')
ON CONFLICT (version) DO NOTHING;
