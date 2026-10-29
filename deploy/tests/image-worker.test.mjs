import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createImageWorkerService,createImageWorkerHandler} from '../lib/image-worker.mjs';
import {createImageHandler} from '../lib/images.mjs';
import {hash} from '../lib/security.mjs';

const ORIGIN='https://studio.test';
const INVALID_IMAGE='data:image/png;base64,abcd';
// The regular image validator is shared with direct generation and imports.
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xc1sAAAAASUVORK5CYII=';
async function setup(t,{configure=true}={}){
 const db=new PGlite(),query=async(sql,params=[])=>(await db.query(sql,params)).rows;
 t.after(()=>db.close());let current=Date.now(),credential;
 for(const name of ['schema.sql','migrations/estimated-token-quota.sql','image-schema.sql','migrations/mac-image-worker.sql'])
  await db.exec(await readFile(new URL('../'+name,import.meta.url),'utf8'));
 const users={};
 for(const [id,role] of [['a','user'],['b','user'],['admin','admin']]){
  users[id]={id,role,session_version:1};
  await query('INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES($1,$1,$1,$2,$3,0)',[id,'unused',role]);
  await query('INSERT INTO studio_sessions VALUES($1,$2,1,$3)',[hash('session-'+id),id,current+3600000]);
 }
 const options={publicOrigin:ORIGIN,now:()=>current},handler=createImageWorkerHandler(query,options),service=createImageWorkerService(query,options);
 const admin=(action,input,user='admin',headers={})=>handler(new Request(ORIGIN+'/api/image-worker?action='+action,{method:input===undefined?'GET':'POST',headers:{Origin:ORIGIN,Cookie:'__Host-jbp-session=session-'+user,'Content-Type':'application/json',...headers},...(input===undefined?{}:{body:JSON.stringify(input)})}));
 const worker=(action,input={},overrides={})=>handler(new Request(ORIGIN+'/api/image-worker?action='+action,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',...overrides},body:JSON.stringify(input)}));
 async function rotate(){const r=await admin('config',{});assert.equal(r.status,201);const config=(await r.json()).config;credential=config.workerToken;return config;}
 if(configure)await rotate();
 const submit=async(owner='a',overrides={},extra={})=>{
  const data={requestId:randomUUID(),projectId:'project-'+owner,projectTitle:'作品-'+owner,name:'角色正面',kind:'角色',prompt:'中国人物定妆照',ratio:'9:16',resolution:'1k',metadata:{entityId:'hero',slot:'front'},...overrides};
  return service.submit({user:users[owner],sessionHash:hash('session-'+owner),data,inputHash:hash(JSON.stringify(data)),amount:2000,references:[],referenceIds:[],origin:ORIGIN,...extra});
 };
 const importImage=async(owner='a')=>{
  const images=createImageHandler(query,{key:'',now:()=>current}),request=new Request(ORIGIN+'/api/images?action=import',{method:'POST',headers:{Origin:ORIGIN,Cookie:'__Host-jbp-session=session-'+owner},body:JSON.stringify({requestId:randomUUID(),kind:'角色',dataUrl:IMAGE})});
  const response=await images(request);assert.equal(response.status,201);return (await response.json()).item;
 };
 return {db,query,handler,admin,worker,rotate,submit,service,importImage,advance:ms=>current+=ms,now:()=>current,credential:()=>credential};
}

test('configuration is administrator-only; worker auth rejects browser origins and unknown fields',async t=>{
 const s=await setup(t,{configure:false});
 assert.deepEqual(await s.service.status(),{configured:false,online:false});
 assert.equal((await s.admin('config',{},'a')).status,403);
 assert.equal((await s.admin('status',undefined,'missing')).status,401);
 assert.equal((await s.admin('config',{owner:'a'})).status,400);
 const config=await s.rotate();
 assert.deepEqual(Object.keys(config).sort(),['format','origin','workerId','workerToken']);
 assert.equal(config.format,'jbp-mac-image-worker-v1');assert.equal(config.workerId,'primary');assert.equal(config.origin,ORIGIN);
 assert.match(config.workerToken,/^[A-Za-z0-9_-]{43}$/);
 const row=(await s.query('SELECT * FROM studio_image_workers'))[0];assert.equal(row.token_hash,hash(config.workerToken));assert.notEqual(row.token_hash,config.workerToken);
 assert.equal((await s.worker('heartbeat',{}, {Authorization:'Bearer invalid'})).status,401);
 for(const headers of [{Origin:ORIGIN},{Origin:''},{'Sec-Fetch-Site':'same-origin'}])assert.equal((await s.worker('poll',{},headers)).status,403);
 assert.equal((await s.worker('poll',{owner:'a'})).status,400);
 assert.deepEqual(await (await s.worker('heartbeat')).json(),{connected:true});
 assert.deepEqual(await (await s.admin('status')).json(),{configured:true,online:true});
 s.advance(45000);assert.deepEqual(await s.service.status(),{configured:true,online:false});
});

test('submission is atomic, reserves once, and never converts a legacy or uncertain request into dispatch',async t=>{
 const s=await setup(t,{configure:false});
 await assert.rejects(s.submit(),/IMAGE_WORKER_UNAVAILABLE/);
 assert.equal((await s.query('SELECT * FROM studio_image_jobs')).length,0);
 assert.equal((await s.query('SELECT * FROM studio_quota_entries')).length,0);
 await s.rotate();
 await s.admin('revoke',{});
 // The worker exists but is inactive: begin's reservation must roll back when
 // the enclosing queue function rejects dispatch after studio_image_begin.
 await assert.rejects(s.submit(),/IMAGE_WORKER_UNAVAILABLE/);
 assert.equal((await s.query('SELECT * FROM studio_image_jobs')).length,0);
 assert.equal((await s.query('SELECT * FROM studio_quota_entries')).length,0);
 await s.rotate();
 const requestId=randomUUID(),data={requestId,projectId:'project-a',projectTitle:'作品-a',name:'角色正面',kind:'角色',prompt:'中国人物定妆照',ratio:'9:16',resolution:'1k',metadata:{entityId:'hero',slot:'front'}};
 const [first,repeat]=await Promise.all([s.submit('a',data),s.submit('a',data)]);
 assert.equal(first.started,true);assert.equal(first.job.dispatch_state,'queued');assert.equal(repeat.started,false);assert.equal(first.job.id,repeat.job.id);
 assert.equal((await s.query('SELECT * FROM studio_image_dispatch')).length,1);
 assert.equal((await s.query('SELECT * FROM studio_quota_entries')).length,1);
 const legacy={...data,id:randomUUID(),requestId:randomUUID(),inputHash:'legacy-input'};
 await s.query('SELECT studio_image_begin($1,$2,1,$3::jsonb,2000,$4)',['b',hash('session-b'),JSON.stringify(legacy),s.now()]);
 await s.query("UPDATE studio_image_jobs SET status='uncertain' WHERE id=$1",[legacy.id]);
 const old=await s.submit('b',legacy,{inputHash:legacy.inputHash});
 assert.equal(old.started,false);assert.equal(old.job.status,'uncertain');assert.equal(old.job.dispatch_state,null);
 assert.equal((await s.query('SELECT * FROM studio_image_dispatch')).length,1);
 await assert.rejects(s.submit('a',{...data,prompt:'不同内容'}),/IMAGE_REQUEST_CONFLICT/);
});

test('single worker claims once across accounts and completion uses persisted ownership and metadata exactly once',async t=>{
 const s=await setup(t),a=await s.submit('a');s.advance(1);const b=await s.submit('b');
 const polled=await Promise.all([s.worker('poll'),s.worker('poll')]);
 const jobs=await Promise.all(polled.map(r=>r.json())),claimed=jobs.find(x=>x.job)?.job;
 assert.equal(jobs.filter(x=>x.job).length,1);assert.equal(claimed.id,a.job.id);
 assert.deepEqual(Object.keys(claimed).sort(),['id','lease','prompt','ratio','references','resolution']);
 assert.doesNotMatch(JSON.stringify(claimed),/owner|project|metadata|workerToken|session_hash/);
 for(const extra of [{owner:'b'},{projectId:'hijack'},{metadata:{slot:'other'}},{error:'REJECTED',dataUrl:IMAGE}])
  assert.equal((await s.worker('complete',{id:claimed.id,lease:claimed.lease,dataUrl:IMAGE,...extra})).status,400);
 const complete={id:claimed.id,lease:claimed.lease,dataUrl:IMAGE};
 for(let i=0;i<2;i++)assert.deepEqual(await (await s.worker('complete',complete)).json(),{saved:true,status:'done'});
 assert.equal((await s.worker('complete',{id:claimed.id,lease:claimed.lease,error:'REJECTED'})).status,409);
 const images=await s.query('SELECT * FROM studio_images');assert.equal(images.length,1);assert.equal(images[0].owner,'a');assert.equal(images[0].project_id,'project-a');assert.deepEqual(images[0].metadata,a.job.metadata);
 const entry=(await s.query("SELECT * FROM studio_quota_entries WHERE owner='a'"))[0];assert.equal(entry.state,'charged');assert.equal(Number(entry.charged),2000);
 const next=(await (await s.worker('poll')).json()).job;assert.equal(next.id,b.job.id);
 // Replaying the prior result must not release the newer job's worker slot.
 await s.worker('complete',complete);assert.equal((await (await s.worker('poll')).json()).job,null);
 assert.equal((await s.service.decorate(b.job)).dispatch_state,'leased');
 assert.equal((await s.service.decorate({...b.job,owner:'a'})).dispatch_state,null);
});

test('claim rechecks active session, source freeze/deletion and reference ownership before any generation',async t=>{
 for(const mode of ['disabled','session','parent-lock','parent-delete','foreign-reference']){
  await t.test(mode,async t=>{
   const s=await setup(t),parent=await s.importImage(mode==='foreign-reference'?'b':'a');
   const task=await s.submit('a',mode.startsWith('parent')?{metadata:{parentImageId:parent.id}}:{},{references:[IMAGE],referenceIds:[parent.id]});
   if(mode==='disabled')await s.query("UPDATE studio_accounts SET active=false WHERE id='a'");
   if(mode==='session')await s.query("UPDATE studio_accounts SET session_version=2 WHERE id='a'");
   if(mode==='parent-lock')await s.query('UPDATE studio_asset_records SET admin_locked=true WHERE asset_id=$1',[parent.id]);
   if(mode==='parent-delete')await s.query('UPDATE studio_asset_records SET admin_deleted=true WHERE asset_id=$1',[parent.id]);
   assert.equal((await (await s.worker('poll')).json()).job,null);
   assert.equal((await s.query('SELECT status FROM studio_image_jobs WHERE id=$1',[task.job.id]))[0].status,'failed');
   assert.equal((await s.query("SELECT state FROM studio_quota_entries WHERE owner='a'"))[0].state,'released');
  });
 }
});

test('completion rechecks session and referenced assets, and locked images remain valid ordinary references',async t=>{
 for(const mode of ['disabled','expired-session','parent-lock','reference-delete','member-delete','locked-reference']){
  await t.test(mode,async t=>{
   const s=await setup(t),parent=await s.importImage(),task=await s.submit('a',mode==='parent-lock'?{metadata:{parentImageId:parent.id}}:{},{references:[IMAGE],referenceIds:[parent.id]});
   const job=(await (await s.worker('poll')).json()).job;assert.equal(job.id,task.job.id);
   if(mode==='disabled')await s.query("UPDATE studio_accounts SET active=false WHERE id='a'");
   if(mode==='expired-session')await s.query("DELETE FROM studio_sessions WHERE user_id='a'");
   if(mode==='parent-lock'||mode==='locked-reference')await s.query('UPDATE studio_asset_records SET admin_locked=true WHERE asset_id=$1',[parent.id]);
   if(mode==='reference-delete')await s.query('UPDATE studio_asset_records SET admin_deleted=true WHERE asset_id=$1',[parent.id]);
   if(mode==='member-delete')await s.query('UPDATE studio_images SET member_deleted=true WHERE id=$1',[parent.id]);
   const result=await (await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE})).json();
   assert.deepEqual(result,{saved:true,status:mode==='locked-reference'?'done':'failed'});
   assert.equal((await s.query('SELECT * FROM studio_images')).length,mode==='locked-reference'?2:1);
   assert.equal((await s.query("SELECT state FROM studio_quota_entries WHERE owner='a'"))[0].state,mode==='locked-reference'?'charged':'released');
  });
 }
});

test('owner cleanup expires only its queued tasks, releases reservations, and leaves legacy jobs untouched',async t=>{
 const s=await setup(t),a=await s.submit('a'),b=await s.submit('b');
 const legacyId=randomUUID(),legacy={id:legacyId,requestId:randomUUID(),inputHash:'old',projectId:'p',projectTitle:'旧稿',name:'旧图',kind:'角色',prompt:'旧任务',ratio:'9:16',resolution:'1k'};
 await s.query('SELECT studio_image_begin($1,$2,1,$3::jsonb,2000,$4)',['a',hash('session-a'),JSON.stringify(legacy),s.now()]);
 s.advance(900001);await s.service.cleanup('a');
 const rows=await s.query('SELECT id,status FROM studio_image_jobs');
 assert.equal(rows.find(j=>j.id===a.job.id).status,'failed');assert.equal(rows.find(j=>j.id===b.job.id).status,'running');assert.equal(rows.find(j=>j.id===legacyId).status,'running');
 assert.equal((await s.service.decorate(a.job)).dispatch_state,'done');assert.equal((await s.service.decorate(b.job)).dispatch_state,'queued');
 assert.equal((await s.query("SELECT state FROM studio_quota_entries WHERE request_key=$1",['media:image:'+a.job.request_key]))[0].state,'released');
});

test('lease expiry becomes uncertain, keeps quota held, rejects late results and never reclaims the task',async t=>{
 const s=await setup(t),task=await s.submit(),job=(await (await s.worker('poll')).json()).job;
 s.advance(300000);await s.worker('heartbeat');
 s.advance(300000);await s.service.cleanup('a');
 assert.equal((await s.service.decorate(task.job)).dispatch_state,'uncertain');
 assert.equal((await s.query('SELECT status FROM studio_image_jobs WHERE id=$1',[job.id]))[0].status,'uncertain');
 assert.equal((await s.query('SELECT state FROM studio_quota_entries'))[0].state,'reserved');
 assert.equal((await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE})).status,409);
 for(let i=0;i<2;i++)assert.equal((await (await s.worker('poll')).json()).job,null);
 assert.equal((await s.query('SELECT * FROM studio_image_dispatch')).length,1);
});

test('completion rollback preserves the lease and reservation; only retransmitting the result settles it once',async t=>{
 const s=await setup(t);await s.submit();const job=(await (await s.worker('poll')).json()).job,input={id:job.id,lease:job.lease,dataUrl:IMAGE};
 await s.db.exec("CREATE FUNCTION test_image_settlement_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='charged' THEN RAISE EXCEPTION 'synthetic-private-database-error'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail BEFORE UPDATE ON studio_quota_entries FOR EACH ROW EXECUTE FUNCTION test_image_settlement_fail();");
 const failed=await s.worker('complete',input);assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/synthetic-private/);
 assert.equal((await s.query('SELECT * FROM studio_images')).length,0);
 assert.equal((await s.query('SELECT state FROM studio_image_dispatch'))[0].state,'leased');
 assert.equal((await s.query('SELECT state FROM studio_quota_entries'))[0].state,'reserved');
 await s.db.exec('DROP TRIGGER test_fail ON studio_quota_entries');
 assert.deepEqual(await (await s.worker('complete',input)).json(),{saved:true,status:'done'});
 assert.deepEqual(await (await s.worker('complete',input)).json(),{saved:true,status:'done'});
 assert.equal((await s.query('SELECT * FROM studio_images')).length,1);
});

test('released quota cannot be charged by a late completion and origins are bound to the configured site',async t=>{
 const s=await setup(t),task=await s.submit(),job=(await (await s.worker('poll')).json()).job;
 await assert.rejects(s.submit('b',{}, {origin:'https://other.test'}),error=>error.status===403);
 await s.query("SELECT studio_quota_change('a',$1,'release','image',0,'',$2)",['media:image:'+task.job.request_key,s.now()]);
 const response=await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE});assert.equal(response.status,503);
 assert.equal((await s.query('SELECT * FROM studio_images')).length,0);
 assert.equal((await s.query('SELECT state FROM studio_quota_entries'))[0].state,'released');
 const otherHandler=createImageWorkerHandler(s.query,{publicOrigin:'https://other.test',now:s.now});
 const otherRequest=(action,input={})=>otherHandler(new Request('https://other.test/api/image-worker?action='+action,{method:'POST',headers:{Authorization:'Bearer '+s.credential()},body:JSON.stringify(input)}));
 assert.equal((await otherRequest('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE})).status,409);
 s.advance(600000);await s.service.cleanup('a');await s.submit('b');
 assert.equal((await (await otherRequest('poll')).json()).job,null);
 assert.equal((await (await s.worker('poll')).json()).job?.prompt,'中国人物定妆照');
});

test('revocation and rotation reject old credentials and leases without rescheduling dispatched work',async t=>{
 const s=await setup(t),task=await s.submit(),job=(await (await s.worker('poll')).json()).job,old=s.credential();
 assert.deepEqual(await (await s.admin('revoke',{})).json(),{revoked:true});
 assert.equal((await s.worker('heartbeat')).status,401);assert.deepEqual(await s.service.status(),{configured:false,online:false});
 await s.rotate();
 assert.equal((await s.worker('heartbeat',{}, {Authorization:'Bearer '+old})).status,401);
 assert.equal((await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE})).status,409);
 assert.equal((await s.service.decorate(task.job)).dispatch_state,'uncertain');
 assert.equal((await s.query('SELECT state FROM studio_quota_entries'))[0].state,'reserved');
 assert.equal((await (await s.worker('poll')).json()).job,null);
});

test('explicit rejection releases quota; uncertain result holds it; malformed images never settle or retry generation',async t=>{
 const s=await setup(t);
 for(const error of ['REJECTED','UNCERTAIN']){
  await s.submit();const job=(await (await s.worker('poll')).json()).job,body={id:job.id,lease:job.lease,error};
  assert.equal((await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:INVALID_IMAGE})).status,400);
  assert.equal((await s.query('SELECT state FROM studio_image_dispatch WHERE job_id=$1',[job.id]))[0].state,'leased');
  for(let i=0;i<2;i++)assert.deepEqual(await (await s.worker('complete',body)).json(),{saved:true,status:error==='REJECTED'?'failed':'uncertain'});
  assert.equal((await s.query('SELECT e.state FROM studio_quota_entries e JOIN studio_image_jobs j ON j.owner=e.owner AND e.request_key=\'media:image:\'||j.request_key WHERE j.id=$1',[job.id]))[0].state,error==='REJECTED'?'released':'reserved');
 }
 assert.equal((await s.query('SELECT * FROM studio_images')).length,0);
 assert.equal((await (await s.worker('poll')).json()).job,null);
});

test('additive migration can run twice without changing existing jobs, images or dispatch leases',async t=>{
 const s=await setup(t);await s.importImage();const task=await s.submit(),job=(await (await s.worker('poll')).json()).job;
 const before=await s.query('SELECT * FROM studio_image_dispatch'),migration=await readFile(new URL('../migrations/mac-image-worker.sql',import.meta.url),'utf8');
 await s.db.exec(migration);await s.db.exec(migration);
 assert.deepEqual(await s.query('SELECT * FROM studio_image_dispatch'),before);
 assert.equal((await s.query('SELECT * FROM studio_images')).length,1);
 assert.equal((await s.query('SELECT status FROM studio_image_jobs WHERE id=$1',[task.job.id]))[0].status,'running');
 assert.deepEqual(await (await s.worker('complete',{id:job.id,lease:job.lease,dataUrl:IMAGE})).json(),{saved:true,status:'done'});
});

test('会员浏览器失败原因只接受固定代码并展示给提交人', async t=>{
 const s=await setup(t),a=await s.submit();
 const claimed=(await (await s.worker('poll')).json()).job;
 assert.equal((await s.worker('complete',{id:claimed.id,lease:claimed.lease,error:'REJECTED',reason:'自由文本'})).status,400);
 assert.equal((await s.worker('complete',{id:claimed.id,lease:claimed.lease,dataUrl:IMAGE,reason:'QUOTA'})).status,400);
 assert.equal((await s.worker('complete',{id:claimed.id,lease:claimed.lease,error:'REJECTED',reason:'CAPTCHA'})).status,200);
 const [job]=await s.query('SELECT status,error FROM studio_image_jobs WHERE id=$1',[a.job.id]);
 assert.equal(job.status,'failed');assert.match(job.error,/人机验证/);
});
