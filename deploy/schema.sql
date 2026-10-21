CREATE TABLE IF NOT EXISTS studio_grok_accounts (id text PRIMARY KEY, label text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS studio_accounts (id text PRIMARY KEY, phone text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','user')), active boolean NOT NULL DEFAULT true, grok_account_id text REFERENCES studio_grok_accounts(id), session_version integer NOT NULL DEFAULT 1, created bigint NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_admin ON studio_accounts(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS studio_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES studio_accounts(id), version integer NOT NULL, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, until_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_account_audit (id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, target text NOT NULL, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_model_modules (id text PRIMARY KEY CHECK(id IN ('script','white','image','storyboard')), name text NOT NULL, url text NOT NULL DEFAULT '', updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_grok_modules (grok_account_id text NOT NULL REFERENCES studio_grok_accounts(id), module_id text NOT NULL CHECK(module_id IN ('script','white','image','storyboard')), url text NOT NULL DEFAULT '', updated bigint NOT NULL, PRIMARY KEY(grok_account_id,module_id));
CREATE TABLE IF NOT EXISTS studio_collab_rooms (id text PRIMARY KEY,owner text NOT NULL REFERENCES studio_accounts(id),title text NOT NULL,document text NOT NULL,revision integer NOT NULL DEFAULT 0,updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_collab_members (room_id text NOT NULL REFERENCES studio_collab_rooms(id),user_id text NOT NULL REFERENCES studio_accounts(id),role text NOT NULL CHECK(role IN ('editor','viewer')),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS studio_collab_presence (room_id text NOT NULL REFERENCES studio_collab_rooms(id),client text NOT NULL,user_id text NOT NULL REFERENCES studio_accounts(id),cursor text NOT NULL,seen bigint NOT NULL,PRIMARY KEY(room_id,client));
CREATE TABLE IF NOT EXISTS studio_sso_tickets (code_hash text PRIMARY KEY,session_hash text NOT NULL,user_id text NOT NULL REFERENCES studio_accounts(id),module_id text NOT NULL,audience text NOT NULL,challenge text NOT NULL,expires bigint NOT NULL,consumed boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS studio_sso_expiry ON studio_sso_tickets(expires);
CREATE TABLE IF NOT EXISTS studio_generation_workers (grok_account_id text PRIMARY KEY REFERENCES studio_grok_accounts(id),token_hash text NOT NULL UNIQUE,active boolean NOT NULL DEFAULT true,seen bigint NOT NULL DEFAULT 0,busy_until bigint NOT NULL DEFAULT 0,created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_generation_jobs (id text PRIMARY KEY,owner text NOT NULL REFERENCES studio_accounts(id),grok_account_id text NOT NULL REFERENCES studio_grok_accounts(id),admin_locked boolean NOT NULL DEFAULT false,admin_deleted boolean NOT NULL DEFAULT false,admin_revision integer NOT NULL DEFAULT 0,session_version integer NOT NULL,request_key text NOT NULL,prompt text NOT NULL,status text NOT NULL CHECK(status IN ('queued','running','done','failed')),result text,error text,lease_hash text,leased_until bigint NOT NULL DEFAULT 0,created bigint NOT NULL,updated bigint NOT NULL,UNIQUE(owner,request_key));
CREATE INDEX IF NOT EXISTS studio_generation_queue ON studio_generation_jobs(grok_account_id,status,created);
CREATE UNIQUE INDEX IF NOT EXISTS studio_generation_one_running ON studio_generation_jobs(grok_account_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS studio_asset_records (
 owner text NOT NULL REFERENCES studio_accounts(id),
 project_id text NOT NULL, asset_id text NOT NULL,
 project_title text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','video','audio')),
 provenance text NOT NULL CHECK(provenance IN ('local','bound-result')),
 prompt text NOT NULL DEFAULT '', preview text NOT NULL DEFAULT '',
 media_url text NOT NULL DEFAULT '', created bigint NOT NULL, synced bigint NOT NULL,
 admin_locked boolean NOT NULL DEFAULT false, admin_deleted boolean NOT NULL DEFAULT false, admin_revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(owner,project_id,asset_id)
);
CREATE INDEX IF NOT EXISTS studio_asset_records_owner_created ON studio_asset_records(owner,created DESC);
-- Production migration: additive only. Apply only after staging validation.
CREATE TABLE IF NOT EXISTS studio_video_jobs (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES studio_accounts(id),
 project_id text NOT NULL,
 request_key text NOT NULL,
 shot_id text NOT NULL DEFAULT '',
 shot_label text NOT NULL DEFAULT '',
 prompt text NOT NULL,
 input_hash text NOT NULL,
 reference_ids text NOT NULL DEFAULT '[]',
 duration integer NOT NULL DEFAULT 8,
 ratio text NOT NULL DEFAULT '16:9',
 model text NOT NULL,
 operation_name text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('submitting','queued','polling','running','succeeded','failed','uncertain','cancelled')),
 output_uri text NOT NULL DEFAULT '',
 error_text text NOT NULL DEFAULT '',
 created bigint NOT NULL,
 updated bigint NOT NULL,
 UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS studio_video_jobs_owner ON studio_video_jobs(owner,created DESC);
CREATE INDEX IF NOT EXISTS studio_video_jobs_active ON studio_video_jobs(owner,status,created);
