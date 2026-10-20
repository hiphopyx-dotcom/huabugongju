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
