-- Estimates are site accounting units, never provider billing measurements.
CREATE TABLE IF NOT EXISTS studio_quota_wallets (owner text PRIMARY KEY REFERENCES studio_accounts(id), allowance bigint CHECK(allowance>=0), updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS studio_quota_rates (id integer PRIMARY KEY CHECK(id=1), image bigint NOT NULL CHECK(image BETWEEN 1 AND 10000000), video_second bigint NOT NULL CHECK(video_second BETWEEN 1 AND 10000000), updated bigint NOT NULL);
INSERT INTO studio_quota_rates VALUES (1,2000,1000,0) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS studio_quota_entries (owner text NOT NULL REFERENCES studio_accounts(id), request_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('text','image','video')), state text NOT NULL CHECK(state IN ('reserved','charged','released')), reserved bigint NOT NULL CHECK(reserved>0), charged bigint NOT NULL DEFAULT 0 CHECK(charged>=0 AND charged<=reserved), detail text NOT NULL, created bigint NOT NULL, updated bigint NOT NULL, PRIMARY KEY(owner,request_key));
CREATE INDEX IF NOT EXISTS studio_quota_entries_owner_state ON studio_quota_entries(owner,state);
CREATE TABLE IF NOT EXISTS studio_quota_audit (id text PRIMARY KEY, actor text NOT NULL REFERENCES studio_accounts(id), owner text, action text NOT NULL, detail text NOT NULL, created bigint NOT NULL);

CREATE OR REPLACE FUNCTION studio_quota_change(p_owner text,p_key text,p_op text,p_kind text,p_amount bigint,p_detail text,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w studio_quota_wallets; e studio_quota_entries; used bigint; held bigint;
BEGIN
 INSERT INTO studio_quota_wallets VALUES(p_owner,NULL,p_now) ON CONFLICT(owner) DO NOTHING;
 SELECT * INTO w FROM studio_quota_wallets WHERE owner=p_owner FOR UPDATE;
 SELECT * INTO e FROM studio_quota_entries WHERE owner=p_owner AND request_key=p_key;
 IF p_op='reserve' THEN
  IF e.owner IS NOT NULL THEN RETURN to_jsonb(e); END IF;
  IF p_amount<1 OR p_amount>1000000000 OR p_kind NOT IN ('text','image','video') THEN RAISE EXCEPTION 'QUOTA_INVALID'; END IF;
  SELECT COALESCE(sum(charged),0),COALESCE(sum(CASE WHEN state='reserved' THEN reserved ELSE 0 END),0) INTO used,held FROM studio_quota_entries WHERE owner=p_owner;
  IF w.allowance IS NOT NULL AND used+held+p_amount>w.allowance THEN RAISE EXCEPTION 'QUOTA_INSUFFICIENT'; END IF;
  INSERT INTO studio_quota_entries VALUES(p_owner,p_key,p_kind,'reserved',p_amount,0,p_detail,p_now,p_now) RETURNING * INTO e;
 ELSIF p_op='limit' THEN
  IF p_amount IS NOT NULL AND (p_amount<0 OR p_amount>1000000000000) THEN RAISE EXCEPTION 'QUOTA_INVALID'; END IF;
  SELECT COALESCE(sum(charged),0),COALESCE(sum(CASE WHEN state='reserved' THEN reserved ELSE 0 END),0) INTO used,held FROM studio_quota_entries WHERE owner=p_owner;
  IF p_amount IS NOT NULL AND p_amount<used+held THEN RAISE EXCEPTION 'QUOTA_BELOW_USED'; END IF;
  UPDATE studio_quota_wallets SET allowance=p_amount,updated=p_now WHERE owner=p_owner;
  RETURN jsonb_build_object('allowance',p_amount);
 ELSIF p_op IN ('charge','release') THEN
  IF e.owner IS NULL THEN RAISE EXCEPTION 'QUOTA_MISSING'; END IF;
  IF e.state<>'reserved' THEN RETURN to_jsonb(e); END IF;
  IF p_op='charge' AND (p_amount<0 OR p_amount>e.reserved) THEN RAISE EXCEPTION 'QUOTA_INVALID'; END IF;
  UPDATE studio_quota_entries SET state=CASE WHEN p_op='charge' THEN 'charged' ELSE 'released' END,charged=CASE WHEN p_op='charge' THEN p_amount ELSE 0 END,updated=p_now WHERE owner=p_owner AND request_key=p_key RETURNING * INTO e;
 ELSE RAISE EXCEPTION 'QUOTA_INVALID';
 END IF;
 RETURN to_jsonb(e);
END $$;

-- Reservation and job creation commit together. Repeated submissions reuse the same job.
CREATE OR REPLACE FUNCTION studio_quota_text_submit(p_id text,p_owner text,p_account text,p_version integer,p_key text,p_prompt text,p_amount bigint,p_now bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e jsonb;
BEGIN
 e:=studio_quota_change(p_owner,'text:'||p_key,'reserve','text',p_amount,'文字生成',p_now);
 IF e->>'state'<>'reserved' AND NOT EXISTS(SELECT 1 FROM studio_generation_jobs WHERE owner=p_owner AND request_key=p_key) THEN RAISE EXCEPTION 'QUOTA_INVALID'; END IF;
 INSERT INTO studio_generation_jobs(id,owner,grok_account_id,session_version,request_key,prompt,status,created,updated) VALUES(p_id,p_owner,p_account,p_version,p_key,p_prompt,'queued',p_now,p_now) ON CONFLICT(owner,request_key) DO NOTHING;
END $$;
