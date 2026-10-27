-- Native image storage. Requires schema.sql and migrations/estimated-token-quota.sql.
-- Provider credentials and remote URLs are never stored in these tables.
CREATE TABLE IF NOT EXISTS studio_image_jobs (
 id text PRIMARY KEY, owner text NOT NULL REFERENCES studio_accounts(id),
 request_key text NOT NULL, input_hash text NOT NULL,
 session_hash text NOT NULL, session_version integer NOT NULL,
 project_id text NOT NULL, project_title text NOT NULL, name text NOT NULL,
 asset_kind text NOT NULL CHECK(asset_kind IN ('角色','场景','道具','分镜')),
 prompt text NOT NULL, ratio text NOT NULL, resolution text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','done','failed','uncertain')),
 error text NOT NULL DEFAULT '', item_id text, amount bigint NOT NULL CHECK(amount>0),
 created bigint NOT NULL, updated bigint NOT NULL, UNIQUE(owner,request_key)
);
CREATE INDEX IF NOT EXISTS studio_image_jobs_owner_created ON studio_image_jobs(owner,created DESC,id);
CREATE TABLE IF NOT EXISTS studio_images (
 id text PRIMARY KEY, owner text NOT NULL REFERENCES studio_accounts(id),
 project_id text NOT NULL, project_title text NOT NULL, name text NOT NULL,
 asset_kind text NOT NULL CHECK(asset_kind IN ('角色','场景','道具','分镜')),
 prompt text NOT NULL, ratio text NOT NULL, resolution text NOT NULL,
 width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 3145728), data_url text NOT NULL,
 source text NOT NULL CHECK(source IN ('generated','imported')),
 request_key text NOT NULL, input_hash text NOT NULL, content_hash text NOT NULL,
 source_id text NOT NULL DEFAULT '', source_project_title text NOT NULL DEFAULT '',
 created bigint NOT NULL, UNIQUE(owner,source,request_key)
);
CREATE INDEX IF NOT EXISTS studio_images_owner_created ON studio_images(owner,created DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_images_import_source ON studio_images(owner,source_id) WHERE source='imported' AND source_id<>'';
-- Additive migration: existing images and jobs retain empty creative metadata.
ALTER TABLE studio_image_jobs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE studio_images ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE studio_images ADD COLUMN IF NOT EXISTS member_deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS studio_images_owner_entity_slot ON studio_images(owner,(metadata->>'entityId'),(metadata->>'slot'),created DESC);
CREATE TABLE IF NOT EXISTS studio_image_workspaces (
 owner text NOT NULL REFERENCES studio_accounts(id), project_id text NOT NULL,
 workspace jsonb NOT NULL CHECK(jsonb_typeof(workspace)='object'),
 version integer NOT NULL CHECK(version>0), updated bigint NOT NULL,
 PRIMARY KEY(owner,project_id)
);

-- A source-deduplicated import still consumes its request id, so replaying that
-- request with different content cannot silently create a second image.
CREATE TABLE IF NOT EXISTS studio_image_import_requests (
 owner text NOT NULL REFERENCES studio_accounts(id), request_key text NOT NULL,
 input_hash text NOT NULL, image_id text NOT NULL REFERENCES studio_images(id),
 PRIMARY KEY(owner,request_key)
);

-- Locking the wallet serializes image submissions with quota changes for this owner.
CREATE OR REPLACE FUNCTION studio_image_session_lock(p_owner text,p_session text,p_version integer,p_now bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id
 WHERE s.token_hash=p_session AND a.id=p_owner AND s.expires>p_now AND a.active=true
 AND s.version=a.session_version AND a.session_version=p_version FOR SHARE OF a,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_SESSION_CHANGED'; END IF;
 INSERT INTO studio_quota_wallets VALUES(p_owner,NULL,p_now) ON CONFLICT(owner) DO NOTHING;
 PERFORM 1 FROM studio_quota_wallets WHERE owner=p_owner FOR UPDATE;
END $$;

CREATE OR REPLACE FUNCTION studio_image_begin(p_owner text,p_session text,p_version integer,p_job jsonb,p_amount bigint,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j studio_image_jobs; e jsonb;
BEGIN
 PERFORM studio_image_session_lock(p_owner,p_session,p_version,p_now);
 SELECT * INTO j FROM studio_image_jobs WHERE owner=p_owner AND request_key=p_job->>'requestId' FOR UPDATE;
 IF FOUND THEN
  IF j.input_hash<>p_job->>'inputHash' THEN RAISE EXCEPTION 'IMAGE_REQUEST_CONFLICT'; END IF;
  RETURN jsonb_build_object('started',false,'job',to_jsonb(j));
 END IF;
 IF (SELECT count(*) FROM studio_image_jobs WHERE owner=p_owner AND status='running')>=2 THEN RAISE EXCEPTION 'IMAGE_BUSY'; END IF;
 e:=studio_quota_change(p_owner,'media:image:'||(p_job->>'requestId'),'reserve','image',p_amount,'图片生成',p_now);
 IF e->>'state'<>'reserved' THEN RAISE EXCEPTION 'IMAGE_REQUEST_CONFLICT'; END IF;
 INSERT INTO studio_image_jobs(id,owner,request_key,input_hash,session_hash,session_version,project_id,project_title,name,asset_kind,prompt,ratio,resolution,status,amount,created,updated,metadata)
 VALUES(p_job->>'id',p_owner,p_job->>'requestId',p_job->>'inputHash',p_session,p_version,p_job->>'projectId',p_job->>'projectTitle',p_job->>'name',p_job->>'kind',p_job->>'prompt',p_job->>'ratio',p_job->>'resolution','running',p_amount,p_now,p_now,COALESCE(p_job->'metadata','{}'::jsonb)) RETURNING * INTO j;
 RETURN jsonb_build_object('started',true,'job',to_jsonb(j));
END $$;

-- Only server-validated image data reaches this helper. The audit row is canonical
-- for administrator lock/delete state and is inserted in the same transaction.
CREATE OR REPLACE FUNCTION studio_image_insert(p_owner text,p_image jsonb,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i studio_images;
BEGIN
 IF COALESCE(p_image->'metadata'->>'parentImageId','')<>'' THEN
  PERFORM 1 FROM studio_images x JOIN studio_asset_records a ON a.owner=x.owner AND a.project_id=x.project_id AND a.asset_id=x.id
   WHERE x.id=p_image->'metadata'->>'parentImageId' AND x.owner=p_owner AND a.admin_locked=false AND a.admin_deleted=false AND x.member_deleted=false FOR SHARE OF a,x;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_PARENT_UNAVAILABLE'; END IF;
 END IF;
 INSERT INTO studio_images(id,owner,project_id,project_title,name,asset_kind,prompt,ratio,resolution,width,height,mime,bytes,data_url,source,request_key,input_hash,content_hash,source_id,source_project_title,created,metadata)
 VALUES(p_image->>'id',p_owner,p_image->>'projectId',p_image->>'projectTitle',p_image->>'name',p_image->>'kind',p_image->>'prompt',p_image->>'ratio',p_image->>'resolution',(p_image->>'width')::integer,(p_image->>'height')::integer,p_image->>'mime',(p_image->>'bytes')::integer,p_image->>'dataUrl',p_image->>'source',p_image->>'requestId',p_image->>'inputHash',p_image->>'contentHash',COALESCE(p_image->>'sourceId',''),COALESCE(p_image->>'sourceProjectTitle',''),p_now,COALESCE(p_image->'metadata','{}'::jsonb)) RETURNING * INTO i;
 INSERT INTO studio_asset_records(owner,project_id,asset_id,project_title,name,kind,provenance,prompt,preview,media_url,created,synced)
 VALUES(p_owner,i.project_id,i.id,i.project_title,i.name,'image',CASE WHEN i.source='generated' THEN 'bound-result' ELSE 'local' END,i.prompt,CASE WHEN length(i.data_url)<=50000 THEN i.data_url ELSE '' END,p_image->>'contentUrl',p_now,p_now);
 RETURN to_jsonb(i)-'data_url';
END $$;

CREATE OR REPLACE FUNCTION studio_image_import(p_owner text,p_session text,p_version integer,p_image jsonb,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i studio_images; a studio_asset_records; r studio_image_import_requests; result jsonb;
BEGIN
 PERFORM studio_image_session_lock(p_owner,p_session,p_version,p_now);
 SELECT * INTO r FROM studio_image_import_requests WHERE owner=p_owner AND request_key=p_image->>'requestId';
 IF FOUND THEN
  IF r.input_hash<>p_image->>'inputHash' THEN RAISE EXCEPTION 'IMAGE_REQUEST_CONFLICT'; END IF;
  SELECT * INTO i FROM studio_images WHERE owner=p_owner AND id=r.image_id;
 ELSE
  SELECT * INTO i FROM studio_images WHERE owner=p_owner AND source='imported' AND request_key=p_image->>'requestId';
  IF FOUND THEN
   IF i.input_hash<>p_image->>'inputHash' THEN RAISE EXCEPTION 'IMAGE_REQUEST_CONFLICT'; END IF;
  ELSE
   IF COALESCE(p_image->>'sourceId','')<>'' THEN SELECT * INTO i FROM studio_images WHERE owner=p_owner AND source='imported' AND source_id=p_image->>'sourceId'; END IF;
   IF i.id IS NOT NULL AND i.content_hash<>p_image->>'contentHash' THEN RAISE EXCEPTION 'IMAGE_SOURCE_CONFLICT'; END IF;
  END IF;
 END IF;
 IF i.id IS NOT NULL THEN
  IF i.member_deleted THEN RAISE EXCEPTION 'IMAGE_MEMBER_DELETED'; END IF;
  SELECT * INTO a FROM studio_asset_records WHERE owner=p_owner AND project_id=i.project_id AND asset_id=i.id;
  IF a.admin_deleted THEN RAISE EXCEPTION 'IMAGE_DELETED'; END IF;
  result:=to_jsonb(i);
 ELSE result:=studio_image_insert(p_owner,p_image,p_now); END IF;
 INSERT INTO studio_image_import_requests VALUES(p_owner,p_image->>'requestId',p_image->>'inputHash',result->>'id') ON CONFLICT(owner,request_key) DO NOTHING;
 RETURN result-'data_url';
END $$;

CREATE OR REPLACE FUNCTION studio_image_complete(p_owner text,p_id text,p_image jsonb,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j studio_image_jobs; i jsonb; e jsonb;
BEGIN
 -- Lock order matches quota/admin operations: wallet, then task.
 PERFORM 1 FROM studio_quota_wallets WHERE owner=p_owner FOR UPDATE;
 SELECT * INTO j FROM studio_image_jobs WHERE owner=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_MISSING'; END IF;
 IF j.status='done' OR j.status='failed' THEN RETURN to_jsonb(j); END IF;
 PERFORM 1 FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=j.session_hash AND a.id=p_owner AND s.expires>p_now AND a.active=true AND s.version=a.session_version AND a.session_version=j.session_version FOR SHARE OF a,s;
 IF NOT FOUND THEN
  PERFORM studio_quota_change(p_owner,'media:image:'||j.request_key,'release','image',0,'',p_now);
  UPDATE studio_image_jobs SET status='failed',error='登录状态已变化，本次结果未保存',updated=p_now WHERE id=j.id RETURNING * INTO j;
  RETURN to_jsonb(j);
 END IF;
 -- An edit cannot bypass a newly applied administrator freeze. Hold the
 -- canonical parent rows until this transaction commits the new version.
 IF COALESCE(p_image->'metadata'->>'parentImageId','')<>'' THEN
  PERFORM 1 FROM studio_images x JOIN studio_asset_records a ON a.owner=x.owner AND a.project_id=x.project_id AND a.asset_id=x.id
   WHERE x.id=p_image->'metadata'->>'parentImageId' AND x.owner=p_owner AND a.admin_locked=false AND a.admin_deleted=false AND x.member_deleted=false FOR SHARE OF a,x;
  IF NOT FOUND THEN
   PERFORM studio_quota_change(p_owner,'media:image:'||j.request_key,'release','image',0,'',p_now);
   UPDATE studio_image_jobs SET status='failed',error='原图已被锁定或删除，修改版未保存，预占额度已释放',updated=p_now WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j);
  END IF;
 END IF;
 -- Revalidate referenced library images against administrator deletion at commit.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_image->'referenceIds','[]'::jsonb)) r(id) WHERE NOT EXISTS(SELECT 1 FROM studio_images x JOIN studio_asset_records a ON a.owner=x.owner AND a.project_id=x.project_id AND a.asset_id=x.id WHERE x.id=r.id AND x.owner=p_owner AND a.admin_deleted=false AND x.member_deleted=false)) THEN
  PERFORM studio_quota_change(p_owner,'media:image:'||j.request_key,'release','image',0,'',p_now);
  UPDATE studio_image_jobs SET status='failed',error='参考图片已不可用，本次结果未保存',updated=p_now WHERE id=j.id RETURNING * INTO j;
  RETURN to_jsonb(j);
 END IF;
 SELECT to_jsonb(q) INTO e FROM studio_quota_entries q WHERE owner=p_owner AND request_key='media:image:'||j.request_key;
 IF e->>'state'='released' THEN RAISE EXCEPTION 'IMAGE_SETTLEMENT_CHANGED'; END IF;
 i:=studio_image_insert(p_owner,p_image,p_now);
 PERFORM studio_quota_change(p_owner,'media:image:'||j.request_key,'charge','image',j.amount,'',p_now);
 UPDATE studio_image_jobs SET status='done',error='',item_id=p_image->>'id',updated=p_now WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

CREATE OR REPLACE FUNCTION studio_image_fail(p_owner text,p_id text,p_definite boolean,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j studio_image_jobs; e jsonb; message text;
BEGIN
 PERFORM 1 FROM studio_quota_wallets WHERE owner=p_owner FOR UPDATE;
 SELECT * INTO j FROM studio_image_jobs WHERE owner=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_MISSING'; END IF;
 IF j.status IN ('done','failed') THEN RETURN to_jsonb(j); END IF;
 IF p_definite THEN
  e:=studio_quota_change(p_owner,'media:image:'||j.request_key,'release','image',0,'',p_now);
  message:=CASE WHEN e->>'state'='released' THEN '图片未生成，预占额度已释放' ELSE '图片未生成，额度已由管理员结算，请联系管理员核对' END;
 ELSE message:='生成结果待核对，未重复调用；请联系管理员核对任务与额度'; END IF;
 UPDATE studio_image_jobs SET status=CASE WHEN p_definite THEN 'failed' ELSE 'uncertain' END,error=message,updated=p_now WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

-- Workspace settings are free; immutable session ownership and optimistic versions
-- are checked in the same transaction. A new workspace is submitted at version 0.
CREATE OR REPLACE FUNCTION studio_image_workspace_save(p_owner text,p_session text,p_session_version integer,p_project text,p_workspace jsonb,p_expected integer,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w studio_image_workspaces;
BEGIN
 PERFORM studio_image_session_lock(p_owner,p_session,p_session_version,p_now);
 SELECT * INTO w FROM studio_image_workspaces WHERE owner=p_owner AND project_id=p_project FOR UPDATE;
 IF FOUND THEN
  IF w.version<>p_expected THEN RAISE EXCEPTION 'IMAGE_WORKSPACE_CONFLICT'; END IF;
  UPDATE studio_image_workspaces SET workspace=p_workspace,version=version+1,updated=p_now WHERE owner=p_owner AND project_id=p_project RETURNING * INTO w;
 ELSE
  IF p_expected<>0 THEN RAISE EXCEPTION 'IMAGE_WORKSPACE_CONFLICT'; END IF;
  INSERT INTO studio_image_workspaces VALUES(p_owner,p_project,p_workspace,1,p_now) RETURNING * INTO w;
 END IF;
 RETURN jsonb_build_object('workspace',w.workspace,'version',w.version);
END $$;

-- Member deletion is separate from administrator trash/restore and never refunds
-- a completed generation. The canonical lock is checked while holding its row.
CREATE OR REPLACE FUNCTION studio_image_delete(p_owner text,p_session text,p_version integer,p_id text,p_now bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i studio_images; a studio_asset_records;
BEGIN
 PERFORM studio_image_session_lock(p_owner,p_session,p_version,p_now);
 SELECT * INTO i FROM studio_images WHERE owner=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_MISSING'; END IF;
 SELECT * INTO a FROM studio_asset_records WHERE owner=p_owner AND project_id=i.project_id AND asset_id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMAGE_MISSING'; END IF;
 IF a.admin_locked THEN RAISE EXCEPTION 'IMAGE_LOCKED'; END IF;
 UPDATE studio_images SET member_deleted=true WHERE owner=p_owner AND id=p_id;
 RETURN jsonb_build_object('ok',true);
END $$;
