CREATE TABLE IF NOT EXISTS studio_grok_accounts (id text PRIMARY KEY, label text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS studio_accounts (id text PRIMARY KEY, phone text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','user')), active boolean NOT NULL DEFAULT true, grok_account_id text REFERENCES studio_grok_accounts(id), session_version integer NOT NULL DEFAULT 1, created bigint NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_admin ON studio_accounts(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS studio_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES studio_accounts(id), version integer NOT NULL, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, until_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_account_audit (id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL, target text NOT NULL, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_model_modules (id text PRIMARY KEY CHECK(id IN ('script','white','image','storyboard')), name text NOT NULL, url text NOT NULL DEFAULT '', updated bigint NOT NULL);
