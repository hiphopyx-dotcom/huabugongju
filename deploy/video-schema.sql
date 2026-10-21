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
