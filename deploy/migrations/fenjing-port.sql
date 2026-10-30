-- Additive only. New tables for publish, sub-admin grants, join requests, and project snapshots.
-- Does not ALTER, DROP, UPDATE, or DELETE existing tables.

CREATE TABLE IF NOT EXISTS studio_publications (
  id text PRIMARY KEY,
  owner text NOT NULL REFERENCES studio_accounts(id),
  kind text NOT NULL CHECK(kind IN ('project','image')),
  subject_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  payload text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created bigint NOT NULL,
  updated bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_publications_subject ON studio_publications(owner, kind, subject_id);
CREATE INDEX IF NOT EXISTS studio_publications_public ON studio_publications(kind, revoked, updated DESC);

CREATE TABLE IF NOT EXISTS studio_account_grants (
  user_id text PRIMARY KEY REFERENCES studio_accounts(id),
  grant_role text NOT NULL CHECK(grant_role IN ('sub-admin')),
  created bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_join_requests (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES studio_collab_rooms(id),
  user_id text NOT NULL REFERENCES studio_accounts(id),
  status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
  created bigint NOT NULL,
  updated bigint NOT NULL,
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS studio_join_requests_room ON studio_join_requests(room_id, status);

CREATE TABLE IF NOT EXISTS studio_project_snapshots (
  id text PRIMARY KEY,
  owner text NOT NULL REFERENCES studio_accounts(id),
  project_id text NOT NULL,
  label text NOT NULL DEFAULT 'latest',
  payload text NOT NULL,
  created bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_project_snapshots_owner ON studio_project_snapshots(owner, project_id, created DESC);
