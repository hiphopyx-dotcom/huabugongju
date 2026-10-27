import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createImageHandler} from '../lib/images.mjs';
import {hash} from '../lib/security.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xc1sAAAAASUVORK5CYII=';
const workspace=()=>({entities:[{id:'character-one',category:'characters',name:'阿青',episode:'1',scope:'series',fields:{description:'人物原文',role:'守门人',identityRegion:'中国 / 东亚面孔',age:'25',gender:'女',appearance:'长发',costume:'灰色长衫',extraPrompt:'保持同一人物'}}],style:'写实摄影',portraitStyle:'灰底定妆'});
async function setup(options={}){
 const db=new PGlite(),query=async(sql,params=[])=>(await db.query(sql,params)).rows;let time=Date.now();
 for(const path of ['../schema.sql','../migrations/estimated-token-quota.sql','../image-schema.sql'])await db.exec(await readFile(new URL(path,import.meta.url),'utf8'));
 for(const [id,role] of [['one','user'],['two','user'],['admin','admin']]){await query('INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES($1,$2,$1,$3,$4,0)',[id,id,'unused',role]);await query('INSERT INTO studio_sessions VALUES($1,$2,1,$3)',[hash('session-'+id),id,time+1000000])}
 const handler=createImageHandler(query,{key:'test',now:()=>time,generate:async()=>({dataUrl:PNG}),...options});
 const call=(action,body,user='one')=>handler(new Request('https://studio.test/api/images?action='+action,{method:body?'POST':'GET',headers:{Origin:'https://studio.test',Cookie:'__Host-jbp-session=session-'+user,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));
 const importImage=async(overrides={},user='one')=>{time++;const response=await call('import',{requestId:randomUUID(),projectId:'project-one',projectTitle:'同一作品',name:'角色定妆',kind:'角色',dataUrl:PNG,...overrides},user);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return (await response.json()).item};
 return {db,query,call,importImage,advance:n=>time+=n};
}

test('工作区按会话账号及项目隔离，乐观版本冲突不覆盖且保存不扣额度',async t=>{
 const s=await setup();t.after(()=>s.db.close());
 assert.deepEqual(await (await s.call('workspace&projectId=project-one')).json(),{workspace:{entities:[],style:'',portraitStyle:''},version:0});
 const a=await s.call('workspace',{projectId:'project-one',workspace:workspace(),version:0});assert.equal(a.status,200);assert.equal((await a.json()).version,1);
 assert.equal((await s.call('workspace',{projectId:'project-one',workspace:{...workspace(),style:'旧窗口'},version:0})).status,409);
 let saved=await (await s.call('workspace&projectId=project-one')).json();assert.equal(saved.workspace.style,'写实摄影');assert.equal(saved.version,1);
 for(const user of ['two','admin'])assert.equal((await (await s.call('workspace&projectId=project-one',null,user)).json()).version,0);
 assert.equal((await (await s.call('workspace&projectId=project-two')).json()).version,0);
 const concurrent=await Promise.all(['窗口甲','窗口乙'].map(style=>s.call('workspace',{projectId:'project-one',workspace:{...workspace(),style},version:1})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 saved=await (await s.call('workspace&projectId=project-one')).json();assert.equal(saved.version,2);
 assert.equal((await s.query('SELECT * FROM studio_quota_entries')).length,0);
 const exact={...workspace(),style:'  保留风格\n',portraitStyle:'\n灰底  '};exact.entities[0].fields.description='  人物原文\n\n';
 const preserved=await (await s.call('workspace',{projectId:'project-two',workspace:exact,version:0})).json();assert.equal(preserved.workspace.style,exact.style);assert.equal(preserved.workspace.entities[0].fields.description,exact.entities[0].fields.description);
 assert.equal((await s.call('workspace&projectId=project-one&owner=two')).status,400);
 assert.equal((await s.call('workspace',{projectId:'project-one',workspace:workspace(),version:2,owner:'two'})).status,400);
});

test('工作区拒绝未知字段、超限实体、重复标识和超长创作内容',async t=>{
 const s=await setup();t.after(()=>s.db.close());const valid=workspace();
 const invalid=[{...valid,owner:'two'},{...valid,entities:[{...valid.entities[0],provider:'private'}]},{...valid,entities:[{...valid.entities[0],category:'accounts'}]},{...valid,entities:[{...valid.entities[0],scope:'public'}]},{...valid,entities:[{...valid.entities[0],fields:{password:'never-upload'}}]},{...valid,entities:[{...valid.entities[0],fields:{description:'x'.repeat(8001)}}]},{...valid,entities:[{...valid.entities[0],id:'../invalid'}]},{...valid,entities:[valid.entities[0],valid.entities[0]]},{...valid,entities:Array.from({length:301},(_,i)=>({...valid.entities[0],id:'entity-'+i}))}];
 for(const value of invalid)assert.equal((await s.call('workspace',{projectId:'project-one',workspace:value,version:0})).status,400);
 for(const version of [-1,1.5,'0',2147483647])assert.equal((await s.call('workspace',{projectId:'project-one',workspace:valid,version})).status,400);
 assert.equal((await s.query('SELECT * FROM studio_image_workspaces')).length,0);
});

test('图片和任务持久保存白名单关联，旧图默认空元信息，幂等不改写旧元信息',async t=>{
 const s=await setup();t.after(()=>s.db.close());const legacy=await s.importImage();assert.deepEqual(legacy.metadata,{});
 const metadata={entityId:'character-one',entityName:'阿青',slot:'front',episode:'1',parentImageId:legacy.id,batchId:'batch-one'},body={requestId:randomUUID(),projectId:'project-one',name:'阿青正面',kind:'角色',prompt:'同一人物',metadata,references:[{id:legacy.id}]};
 const response=await s.call('generate',body),result=await response.json();assert.equal(response.status,201);assert.deepEqual(result.item.metadata,metadata);assert.deepEqual(result.job.metadata,metadata);assert.equal(result.wallet.used,2000);
 const row=(await s.query('SELECT metadata FROM studio_images WHERE id=$1',[result.item.id]))[0];assert.deepEqual(row.metadata,metadata);
 const replay=await (await s.call('generate',{...body,metadata:{...metadata}})).json();assert.equal(replay.item.id,result.item.id);assert.equal(replay.wallet.used,2000);
 assert.equal((await s.call('generate',{...body,metadata:{...metadata,slot:'side'}})).status,409);
 const jobs=(await (await s.call('status')).json()).jobs;assert.deepEqual(jobs.find(j=>j.id===result.job.id).metadata,metadata);
 for(const m of [{provider:'private'},{owner:'two'},{entityId:'a/b'},{slot:'x'.repeat(65)},{parentImageId:'not-a-uuid'},{episode:2},{entityName:'x'.repeat(161)}])assert.equal((await s.call('generate',{...body,requestId:randomUUID(),metadata:m})).status,400);
 const foreign=await s.importImage({},'two');assert.equal((await s.call('generate',{...body,requestId:randomUUID(),metadata:{parentImageId:foreign.id}})).status,404);
 await s.query('UPDATE studio_asset_records SET admin_deleted=true WHERE owner=$1 AND asset_id=$2',['one',legacy.id]);assert.equal((await s.call('generate',{...body,requestId:randomUUID()})).status,404);
 assert.equal((await (await s.call('list',null,'two')).json()).items.some(i=>i.id===result.item.id),false);
});

test('组合筛选和历史分页只读本人未删除图片，搜索将通配符作为普通文字',async t=>{
 const s=await setup();t.after(()=>s.db.close());const meta={entityId:'character-one',entityName:'阿青',slot:'front',episode:'1'};
 const first=await s.importImage({name:'阿青 100%_真实',metadata:meta}),latest=await s.importImage({name:'阿青正面二版',metadata:meta});
 await s.importImage({metadata:{...meta,slot:'side'}});await s.importImage({metadata:{...meta,episode:'2'}});await s.importImage({projectId:'project-two',metadata:meta});await s.importImage({kind:'场景',metadata:meta});await s.importImage({metadata:meta},'two');
 const filter='projectId=project-one&kind='+encodeURIComponent('角色')+'&entityId=character-one&slot=front&episode=1';
 const result=await (await s.call('list&'+filter+'&pageSize=1')).json();assert.equal(result.total,2);assert.equal(result.items[0].id,latest.id);
 const history=await (await s.call('history&'+filter+'&pageSize=1&page=2')).json();assert.equal(history.items[0].id,first.id);assert.equal(history.total,2);
 const searched=await (await s.call('list&projectId=project-one&q='+encodeURIComponent('100%_'))).json();assert.equal(searched.total,1);assert.equal(searched.items[0].id,first.id);
 assert.equal((await (await s.call('list&q='+encodeURIComponent('阿青'))).json()).total,6);
 await s.query('UPDATE studio_asset_records SET admin_deleted=true WHERE owner=$1 AND asset_id=$2',['one',latest.id]);
 assert.equal((await (await s.call('list&'+filter)).json()).total,1);
 for(const suffix of ['kind=invalid','entityId=../bad','slot=bad%2Fslot','q='+encodeURIComponent('x'.repeat(101))])assert.equal((await s.call('list&'+suffix)).status,400);
});

test('槽位选择最新可见版本，管理员删除最新图后回退旧版且不包含其他账号或旧无元信息图',async t=>{
 const s=await setup();t.after(()=>s.db.close());const metadata={entityId:'character-one',slot:'front'};
 const old=await s.importImage({metadata}),latest=await s.importImage({metadata}),side=await s.importImage({metadata:{...metadata,slot:'side'}});
 await s.importImage();await s.importImage({metadata:{entityId:'character-two',slot:'front'}});await s.importImage({projectId:'project-two',metadata});await s.importImage({metadata},'two');
 let items=(await (await s.call('slots&projectId=project-one&entityId=character-one')).json()).items;assert.deepEqual(new Set(items.map(i=>i.id)),new Set([latest.id,side.id]));
 await s.query('UPDATE studio_asset_records SET admin_deleted=true WHERE owner=$1 AND asset_id=$2',['one',latest.id]);
 items=(await (await s.call('slots&projectId=project-one&entityId=character-one')).json()).items;assert.deepEqual(new Set(items.map(i=>i.id)),new Set([old.id,side.id]));
 assert.equal((await (await s.call('slots&projectId=project-one')).json()).items.length,3);
 assert.equal((await s.call('slots&projectId=project-one&owner=two')).status,400);assert.equal((await s.call('slots')).status,400);
});

test('追加式schema可重复执行并保留已有图片、元信息及工作区版本',async t=>{
 const s=await setup();t.after(()=>s.db.close());const image=await s.importImage({metadata:{entityId:'character-one',slot:'front'}});
 await s.call('workspace',{projectId:'project-one',workspace:workspace(),version:0});
 const schema=await readFile(new URL('../image-schema.sql',import.meta.url),'utf8');await s.db.exec(schema);await s.db.exec(schema);
 assert.deepEqual((await (await s.call('list')).json()).items[0].metadata,image.metadata);
 assert.equal((await (await s.call('workspace&projectId=project-one')).json()).version,1);
 assert.equal((await s.query('SELECT * FROM studio_quota_entries')).length,0);
});

test('成员只能软删本人未锁图片，不改管理员标记、不删原件、不退已结算额度',async t=>{
 const s=await setup();t.after(()=>s.db.close());const response=await s.call('generate',{requestId:randomUUID(),projectId:'project-one',kind:'角色',prompt:'定妆照',metadata:{entityId:'character-one',slot:'front'}}),saved=(await response.json()).item;
 for(const user of ['two','admin'])assert.equal((await s.call('delete',{id:saved.id},user)).status,404);
 assert.equal((await s.call('delete',{id:saved.id,owner:'two'})).status,400);
 await s.query('UPDATE studio_asset_records SET admin_locked=true WHERE owner=$1 AND asset_id=$2',['one',saved.id]);
 assert.equal((await s.call('delete',{id:saved.id})).status,403);assert.equal((await s.call('content&id='+saved.id)).status,200);
 await s.query('UPDATE studio_asset_records SET admin_locked=false WHERE owner=$1 AND asset_id=$2',['one',saved.id]);
 for(let i=0;i<2;i++){const deleted=await s.call('delete',{id:saved.id});assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{ok:true})}
 const row=(await s.query('SELECT i.member_deleted,i.data_url,a.admin_deleted FROM studio_images i JOIN studio_asset_records a ON a.owner=i.owner AND a.project_id=i.project_id AND a.asset_id=i.id WHERE i.id=$1',[saved.id]))[0];assert.equal(row.member_deleted,true);assert.equal(row.admin_deleted,false);assert.equal(row.data_url,PNG);
 assert.equal((await (await s.call('status')).json()).wallet.used,2000);
 assert.equal((await (await s.call('list')).json()).total,0);assert.equal((await (await s.call('slots&projectId=project-one')).json()).items.length,0);assert.equal((await s.call('content&id='+saved.id)).status,404);
 assert.equal((await s.call('generate',{requestId:randomUUID(),kind:'角色',prompt:'续图',references:[{id:saved.id}]})).status,404);
 assert.equal((await s.call('import',{requestId:randomUUID(),kind:'角色',dataUrl:PNG,metadata:{parentImageId:saved.id}})).status,404);
});

test('成员删除的历史图片不能被导入复活，槽位自动回退上一未删除版本',async t=>{
 const s=await setup();t.after(()=>s.db.close());const metadata={entityId:'character-one',slot:'front'},old=await s.importImage({metadata});
 s.advance(1);const body={requestId:randomUUID(),projectId:'project-one',kind:'角色',dataUrl:PNG,sourceId:'old-image',metadata},newer=(await (await s.call('import',body)).json()).item;
 assert.equal((await (await s.call('slots&projectId=project-one')).json()).items[0].id,newer.id);
 await s.call('delete',{id:newer.id});assert.equal((await (await s.call('slots&projectId=project-one')).json()).items[0].id,old.id);
 assert.equal((await s.call('import',body)).status,409);assert.equal((await s.call('import',{...body,requestId:randomUUID()})).status,409);
 assert.equal((await s.query('SELECT * FROM studio_images')).length,2);assert.equal((await (await s.call('list')).json()).total,1);
});

test('生成期间成员删除参考图后不保存迟到结果，预占原子释放',async t=>{
 let entered,finish;const started=new Promise(resolve=>entered=resolve),s=await setup({generate:async()=>{entered();return new Promise(resolve=>finish=resolve)}});t.after(()=>s.db.close());
 const reference=await s.importImage(),pending=s.call('generate',{requestId:randomUUID(),projectId:'project-one',kind:'角色',prompt:'侧面',references:[{id:reference.id}],metadata:{parentImageId:reference.id}});await started;
 assert.equal((await s.call('delete',{id:reference.id})).status,200);finish({dataUrl:PNG});const result=await (await pending).json();assert.equal(result.job.status,'failed');assert.equal(result.item,undefined);assert.equal(result.wallet.used,0);assert.equal(result.wallet.held,0);
 assert.equal((await s.query('SELECT * FROM studio_images')).length,1);
});

test('从无metadata列的旧库升级，既有图片默认元信息并保持原幂等输入',async t=>{
 const db=new PGlite();t.after(()=>db.close());const query=async(sql,params=[])=>(await db.query(sql,params)).rows,schema=await readFile(new URL('../image-schema.sql',import.meta.url),'utf8');
 for(const path of ['../schema.sql','../migrations/estimated-token-quota.sql'])await db.exec(await readFile(new URL(path,import.meta.url),'utf8'));
 await db.exec(schema.slice(0,schema.indexOf('-- Additive migration')));
 await query("INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES('one','one','甲','unused','user',0)");await query('INSERT INTO studio_sessions VALUES($1,$2,1,$3)',[hash('session-one'),'one',Date.now()+1000000]);
 const imageId=randomUUID(),requestId=randomUUID(),data={requestId,projectId:'image-library',projectTitle:'图片库',name:'角色图片',kind:'角色',prompt:'',sourceId:'',sourceProjectTitle:''},inputHash=hash(JSON.stringify({...data,contentHash:hash(PNG)}));
 await query("INSERT INTO studio_images(id,owner,project_id,project_title,name,asset_kind,prompt,ratio,resolution,width,height,mime,bytes,data_url,source,request_key,input_hash,content_hash,created) VALUES($1,'one','image-library','图片库','角色图片','角色','','','',1,1,'image/png',1,$2,'imported',$3,$4,$5,0)",[imageId,PNG,requestId,inputHash,hash(PNG)]);
 await query("INSERT INTO studio_asset_records(owner,project_id,asset_id,project_title,name,kind,provenance,created,synced) VALUES('one','image-library',$1,'图片库','角色图片','image','local',0,0)",[imageId]);
 await db.exec(schema);await db.exec(schema);
 const handler=createImageHandler(query,{key:''}),call=(action,body)=>handler(new Request('https://studio.test/api/images?action='+action,{method:body?'POST':'GET',headers:{Origin:'https://studio.test',Cookie:'__Host-jbp-session=session-one'},body:body?JSON.stringify(body):undefined}));
 const listed=await (await call('list')).json();assert.deepEqual(listed.items[0].metadata,{});assert.equal(listed.items[0].id,imageId);
 const replay=await call('import',{requestId,kind:'角色',dataUrl:PNG,metadata:{}});assert.equal(replay.status,201);assert.equal((await replay.json()).item.id,imageId);assert.equal((await query('SELECT * FROM studio_images')).length,1);
});


test('管理员冻结阻止改图与裁剪另存，普通参考仍可用；提交后新增冻结也释放额度',async t=>{
 let complete,started;const begin=new Promise(r=>started=r),gate=new Promise(r=>complete=r);let defer=false,calls=0;
 const s=await setup({generate:async()=>{calls++;if(defer){started();await gate}return {dataUrl:PNG}}});t.after(()=>s.db.close());
 const parent=await s.importImage();await s.query('UPDATE studio_asset_records SET admin_locked=true WHERE owner=$1 AND asset_id=$2',['one',parent.id]);
 const base={requestId:randomUUID(),projectId:'project-one',kind:'角色',prompt:'保留人物，改变表情',references:[{id:parent.id}]};
 assert.equal((await s.call('generate',{...base,metadata:{parentImageId:parent.id}})).status,403);
 assert.equal((await s.call('import',{requestId:randomUUID(),kind:'角色',dataUrl:PNG,metadata:{parentImageId:parent.id}})).status,403);assert.equal(calls,0);
 assert.equal((await (await s.call('generate',base)).json()).job.status,'done');assert.equal(calls,1);
 await s.query('UPDATE studio_asset_records SET admin_locked=false WHERE owner=$1 AND asset_id=$2',['one',parent.id]);defer=true;
 const requestId=randomUUID(),pending=s.call('generate',{...base,requestId,metadata:{parentImageId:parent.id}});await begin;
 await s.query('UPDATE studio_asset_records SET admin_locked=true WHERE owner=$1 AND asset_id=$2',['one',parent.id]);complete();
 const r=await (await pending).json();assert.equal(r.job.status,'failed');assert.match(r.job.error,/锁定/);assert.equal(r.item,undefined);
 const entry=(await s.query("SELECT state,charged FROM studio_quota_entries WHERE owner='one' AND request_key=$1",['media:image:'+requestId]))[0];assert.equal(entry.state,'released');assert.equal(Number(entry.charged),0);
});
