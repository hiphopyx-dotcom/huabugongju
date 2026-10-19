CREATE TABLE IF NOT EXISTS studio_asset_records (
 owner text NOT NULL REFERENCES studio_accounts(id),
 project_id text NOT NULL, asset_id text NOT NULL,
 project_title text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','video','audio')),
 provenance text NOT NULL CHECK(provenance IN ('local','bound-result')),
 prompt text NOT NULL DEFAULT '', preview text NOT NULL DEFAULT '',
 media_url text NOT NULL DEFAULT '', created bigint NOT NULL, synced bigint NOT NULL,
 PRIMARY KEY(owner,project_id,asset_id)
);
CREATE INDEX IF NOT EXISTS studio_asset_records_owner_created ON studio_asset_records(owner,created DESC);
