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

-- Estimates are site accounting units, never provider billing measurements.
CREATE TABLE IF NOT EXISTS studio_quota_wallets (owner text PRIMARY KEY REFERENCES studio_accounts(id), allowance bigint CHECK(allowance>=0), updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_quota_rates (id integer PRIMARY KEY CHECK(id=1), image bigint NOT NULL CHECK(image BETWEEN 1 AND 10000000), video_second bigint NOT NULL CHECK(video_second BETWEEN 1 AND 10000000), updated bigint NOT NULL);
INSERT INTO studio_quota_rates VALUES (1,2000,1000,0) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS studio_quota_entries (owner text NOT NULL REFERENCES studio_accounts(id), request_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('text','image','video')), state text NOT NULL CHECK(state IN ('reserved','charged','released')), reserved bigint NOT NULL CHECK(reserved>0), charged bigint NOT NULL DEFAULT 0 CHECK(charged>=0 AND charged<=reserved), detail text NOT NULL, created bigint NOT NULL, updated bigint NOT NULL, PRIMARY KEY(owner,request_key));
CREATE INDEX IF NOT EXISTS studio_quota_entries_owner_state ON studio_quota_entries(owner,state);
CREATE TABLE IF NOT EXISTS studio_quota_audit (id text PRIMARY KEY, actor text NOT NULL REFERENCES studio_accounts(id), owner text, action text NOT NULL, detail text NOT NULL, created bigint NOT NULL);

-- Independent, append-only review records. Does not modify existing projects.
CREATE TABLE IF NOT EXISTS studio_script_reviews (
  id text PRIMARY KEY,
  owner text NOT NULL REFERENCES studio_accounts(id),
  project_id text NOT NULL,
  part_key text NOT NULL DEFAULT '全文',
  request_key text NOT NULL,
  source_hash text NOT NULL,
  source_text text NOT NULL,
  reference_text text NOT NULL,
  step text NOT NULL DEFAULT 'write',
  draft_one text NOT NULL DEFAULT '',
  review_one text NOT NULL DEFAULT '',
  draft_two text NOT NULL DEFAULT '',
  review_two text NOT NULL DEFAULT '',
  passed boolean NOT NULL DEFAULT false,
  adopted boolean NOT NULL DEFAULT false,
  error_text text NOT NULL DEFAULT '',
  created bigint NOT NULL,
  updated bigint NOT NULL,
  UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS studio_script_reviews_by_user ON studio_script_reviews(owner,created DESC);
