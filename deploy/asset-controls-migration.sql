ALTER TABLE studio_asset_records ADD COLUMN IF NOT EXISTS admin_locked boolean NOT NULL DEFAULT false;
ALTER TABLE studio_asset_records ADD COLUMN IF NOT EXISTS admin_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE studio_asset_records ADD COLUMN IF NOT EXISTS admin_revision integer NOT NULL DEFAULT 0;
ALTER TABLE studio_generation_jobs ADD COLUMN IF NOT EXISTS admin_locked boolean NOT NULL DEFAULT false;
ALTER TABLE studio_generation_jobs ADD COLUMN IF NOT EXISTS admin_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE studio_generation_jobs ADD COLUMN IF NOT EXISTS admin_revision integer NOT NULL DEFAULT 0;
