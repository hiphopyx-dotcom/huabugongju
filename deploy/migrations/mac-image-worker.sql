-- Additive, opt-in dispatch. Existing synchronous and uncertain jobs are never enqueued.
-- Requires image-schema.sql and estimated-token-quota.sql.
CREATE TABLE IF NOT EXISTS studio_image_workers (
 id text PRIMARY KEY CHECK(id='primary'), token_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true, seen bigint NOT NULL DEFAULT 0,
 busy_until bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_image_workers_token ON studio_image_workers(token_hash);
CREATE TABLE IF NOT EXISTS studio_image_dispatch (
 job_id text PRIMARY KEY REFERENCES studio_image_jobs(id) ON DELETE CASCADE,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 worker_id text NOT NULL DEFAULT 'primary' REFERENCES studio_image_workers(id),
 state text NOT NULL CHECK(state IN ('queued','leased','done','uncertain')),
 lease_hash text NOT NULL DEFAULT '', lease_until bigint NOT NULL DEFAULT 0,
 result_hash text NOT NULL DEFAULT '', created bigint NOT NULL, updated bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_image_dispatch_queue ON studio_image_dispatch(worker_id,state,created,job_id);

-- Caller already holds the owner's wallet and job. These locks retain the
-- identity/source checks until claim or completion commits.
CREATE OR REPLACE FUNCTION studio_image_dispatch_valid(j studio_image_jobs,p_payload jsonb,p_now bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ref text;
BEGIN
 PERFORM 1 FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id
 WHERE s.token_hash=j.session_hash AND a.id=j.owner AND s.expires>p_now AND a.active
 AND s.version=a.session_version AND a.session_version=j.session_version FOR SHARE OF a,s;
 IF NOT FOUND THEN RETURN false; END IF;
 IF COALESCE(j.metadata->>'parentImageId','')<>'' THEN
  PERFORM 1 FROM studio_images i JOIN studio_asset_records a ON a.owner=i.owner AND a.project_id=i.project_id AND a.asset_id=i.id
  WHERE i.owner=j.owner AND i.id=j.metadata->>'parentImageId' AND NOT i.member_deleted
  AND NOT a.admin_deleted AND NOT a.admin_locked FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN false; END IF;
 END IF;
 FOR ref IN SELECT jsonb_array_elements_text(COALESCE(p_payload->'referenceIds','[]'::jsonb)) LOOP
  PERFORM 1 FROM studio_images i JOIN studio_asset_records a ON a.owner=i.owner AND a.project_id=i.project_id AND a.asset_id=i.id
  WHERE i.owner=j.owner AND i.id=ref AND NOT i.member_deleted AND NOT a.admin_deleted FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_begin(p_owner text,p_session text,p_version integer,p_job jsonb,p_amount bigint,p_payload jsonb,p_now bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; dispatch_state text;
BEGIN
 -- Acquire the worker before the wallet: the dispatch FK also takes a worker
 -- row lock, so taking it after studio_image_begin could deadlock a claim.
 PERFORM 1 FROM studio_image_workers WHERE id='primary' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_WORKER_UNAVAILABLE'; END IF;
 result:=studio_image_begin(p_owner,p_session,p_version,p_job,p_amount,p_now);
 IF (result->>'started')::boolean THEN
  IF NOT EXISTS(SELECT 1 FROM studio_image_workers WHERE id='primary' AND active) THEN RAISE EXCEPTION 'IMAGE_WORKER_UNAVAILABLE'; END IF;
  INSERT INTO studio_image_dispatch(job_id,payload,worker_id,state,created,updated)
  VALUES(result->'job'->>'id',p_payload,'primary','queued',p_now,p_now);
 END IF;
 SELECT state INTO dispatch_state FROM studio_image_dispatch WHERE job_id=result->'job'->>'id';
 RETURN jsonb_build_object('started',result->'started','job',(result->'job')||jsonb_build_object('dispatch_state',dispatch_state));
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_cleanup(p_owner text,p_now bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE candidate record; j studio_image_jobs; d studio_image_dispatch; settled jsonb;
BEGIN
 -- Shared worker serializes claim/complete/rotation; legacy image helpers never
 -- lock this row. Thereafter retain the existing wallet -> job lock order.
 PERFORM 1 FROM studio_image_workers WHERE id='primary' FOR UPDATE;
 FOR candidate IN SELECT x.job_id FROM studio_image_dispatch x JOIN studio_image_jobs y ON y.id=x.job_id
  WHERE y.owner=p_owner AND x.state IN ('queued','leased') ORDER BY x.created,x.job_id LOOP
  PERFORM 1 FROM studio_quota_wallets WHERE owner=p_owner FOR UPDATE;
  SELECT * INTO j FROM studio_image_jobs WHERE id=candidate.job_id AND owner=p_owner FOR UPDATE;
  SELECT * INTO d FROM studio_image_dispatch WHERE job_id=j.id FOR UPDATE;
  IF j.status IN ('done','failed') THEN
   UPDATE studio_image_dispatch SET state='done',updated=p_now WHERE job_id=j.id;
  ELSIF d.state='queued' AND (d.created<=p_now-900000 OR NOT studio_image_dispatch_valid(j,d.payload,p_now)) THEN
   settled:=studio_image_fail(j.owner,j.id,true,p_now);
   UPDATE studio_image_dispatch SET state='done',updated=p_now WHERE job_id=j.id;
  ELSIF d.state='leased' AND d.lease_until<=p_now THEN
   settled:=studio_image_fail(j.owner,j.id,false,p_now);
   UPDATE studio_image_dispatch SET state='uncertain',updated=p_now WHERE job_id=j.id;
  ELSIF j.status<>'running' THEN
   UPDATE studio_image_dispatch SET state='uncertain',updated=p_now WHERE job_id=j.id;
  END IF;
 END LOOP;
 UPDATE studio_image_workers SET busy_until=0 WHERE id='primary'
 AND NOT EXISTS(SELECT 1 FROM studio_image_dispatch WHERE worker_id='primary' AND state='leased' AND lease_until>p_now);
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_configure(p_hash text,p_active boolean,p_now bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE candidate record; j studio_image_jobs;
BEGIN
 INSERT INTO studio_image_workers(id,token_hash,active) VALUES('primary',p_hash,p_active) ON CONFLICT(id) DO NOTHING;
 PERFORM 1 FROM studio_image_workers WHERE id='primary' FOR UPDATE;
 FOR candidate IN SELECT x.job_id,y.owner FROM studio_image_dispatch x JOIN studio_image_jobs y ON y.id=x.job_id
  WHERE x.worker_id='primary' AND x.state='leased' ORDER BY x.created,x.job_id LOOP
  PERFORM 1 FROM studio_quota_wallets WHERE owner=candidate.owner FOR UPDATE;
  SELECT * INTO j FROM studio_image_jobs WHERE id=candidate.job_id FOR UPDATE;
  PERFORM studio_image_fail(j.owner,j.id,false,p_now);
  UPDATE studio_image_dispatch SET state='uncertain',updated=p_now WHERE job_id=j.id;
 END LOOP;
 -- Rotation invalidates every prior lease, including completed-result replays.
 UPDATE studio_image_dispatch SET lease_hash='',lease_until=0 WHERE worker_id='primary';
 UPDATE studio_image_workers SET token_hash=CASE WHEN p_active THEN p_hash ELSE token_hash END,
 active=p_active,seen=0,busy_until=0 WHERE id='primary';
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_heartbeat(p_token text,p_now bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE studio_image_workers SET seen=p_now WHERE id='primary' AND token_hash=p_token AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_WORKER_AUTH'; END IF;
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_poll(p_token text,p_lease text,p_now bigint,p_until bigint,p_origin text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w studio_image_workers; candidate record; j studio_image_jobs; d studio_image_dispatch;
BEGIN
 SELECT * INTO w FROM studio_image_workers WHERE id='primary' AND token_hash=p_token AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_WORKER_AUTH'; END IF;
 UPDATE studio_image_workers SET seen=p_now WHERE id='primary';
 FOR candidate IN SELECT DISTINCT y.owner FROM studio_image_dispatch x JOIN studio_image_jobs y ON y.id=x.job_id
  WHERE x.worker_id='primary' AND x.state='leased' AND x.lease_until<=p_now LOOP
  PERFORM studio_image_worker_cleanup(candidate.owner,p_now);
 END LOOP;
 IF EXISTS(SELECT 1 FROM studio_image_dispatch WHERE worker_id='primary' AND state='leased' AND lease_until>p_now) THEN RETURN NULL; END IF;
 LOOP
  SELECT x.job_id,y.owner INTO candidate FROM studio_image_dispatch x JOIN studio_image_jobs y ON y.id=x.job_id
  WHERE x.worker_id='primary' AND x.state='queued' AND x.payload->>'origin'=p_origin ORDER BY x.created,x.job_id LIMIT 1;
  IF NOT FOUND THEN UPDATE studio_image_workers SET busy_until=0 WHERE id='primary'; RETURN NULL; END IF;
  PERFORM 1 FROM studio_quota_wallets WHERE owner=candidate.owner FOR UPDATE;
  SELECT * INTO j FROM studio_image_jobs WHERE id=candidate.job_id FOR UPDATE;
  SELECT * INTO d FROM studio_image_dispatch WHERE job_id=j.id FOR UPDATE;
  IF j.status<>'running' THEN
   UPDATE studio_image_dispatch SET state=CASE WHEN j.status IN ('done','failed') THEN 'done' ELSE 'uncertain' END,updated=p_now WHERE job_id=j.id;
  ELSIF d.created<=p_now-900000 OR NOT studio_image_dispatch_valid(j,d.payload,p_now) THEN
   PERFORM studio_image_fail(j.owner,j.id,true,p_now);
   UPDATE studio_image_dispatch SET state='done',updated=p_now WHERE job_id=j.id;
  ELSE
   UPDATE studio_image_dispatch SET state='leased',lease_hash=p_lease,lease_until=p_until,updated=p_now WHERE job_id=j.id;
   UPDATE studio_image_workers SET busy_until=p_until WHERE id='primary';
   RETURN jsonb_build_object('id',j.id,'payload',d.payload);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION studio_image_worker_complete(p_token text,p_id text,p_lease text,p_result text,p_image jsonb,p_error text,p_now bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE owner_id text; j studio_image_jobs; d studio_image_dispatch; settled jsonb;
BEGIN
 PERFORM 1 FROM studio_image_workers WHERE id='primary' AND token_hash=p_token AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_WORKER_AUTH'; END IF;
 SELECT owner INTO owner_id FROM studio_image_jobs WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_WORKER_LEASE'; END IF;
 PERFORM 1 FROM studio_quota_wallets WHERE owner=owner_id FOR UPDATE;
 SELECT * INTO j FROM studio_image_jobs WHERE id=p_id FOR UPDATE;
 SELECT * INTO d FROM studio_image_dispatch WHERE job_id=p_id FOR UPDATE;
 IF NOT FOUND OR d.worker_id<>'primary' OR d.lease_hash<>p_lease OR d.lease_until<=p_now THEN RAISE EXCEPTION 'IMAGE_WORKER_LEASE'; END IF;
 IF d.result_hash<>'' AND d.state IN ('done','uncertain') THEN
  IF d.result_hash<>p_result THEN RAISE EXCEPTION 'IMAGE_WORKER_RESULT_CONFLICT'; END IF;
  RETURN to_jsonb(j);
 END IF;
 IF d.state<>'leased' OR j.status<>'running' THEN RAISE EXCEPTION 'IMAGE_WORKER_LEASE'; END IF;
 IF NOT studio_image_dispatch_valid(j,d.payload,p_now) THEN
  settled:=studio_image_fail(j.owner,j.id,true,p_now);
 ELSIF p_error IS NOT NULL THEN
  IF p_error NOT IN ('REJECTED','UNCERTAIN') THEN RAISE EXCEPTION 'IMAGE_WORKER_RESULT_CONFLICT'; END IF;
  settled:=studio_image_fail(j.owner,j.id,p_error='REJECTED',p_now);
 ELSE
  settled:=studio_image_complete(j.owner,j.id,p_image,p_now);
 END IF;
 UPDATE studio_image_dispatch SET state=CASE WHEN settled->>'status'='uncertain' THEN 'uncertain' ELSE 'done' END,
 result_hash=p_result,updated=p_now WHERE job_id=j.id;
 UPDATE studio_image_workers SET seen=p_now,busy_until=0 WHERE id='primary';
 RETURN settled;
END $$;
