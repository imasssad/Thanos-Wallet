-- Adds the profile fields used by the contractor compliance dashboard.
-- The new contractor document/photo/type tables are created by SQLAlchemy's
-- current create_all() bootstrap. Replace this with an Alembic revision when
-- formal migrations are introduced.

ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS dba_name VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS primary_contact VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS website VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS county VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS address VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS zip_code VARCHAR;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS years_in_business INTEGER;
ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS employee_count INTEGER;
