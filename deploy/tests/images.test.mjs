import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createImageHandler,imageServerConfig,validateImageData,IMAGE_LIMITS} from '../lib/images.mjs';
import {hash} from '../lib/security.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xc1sAAAAASUVORK5CYII=';
const reqId='71d885b0-13c0-43ef-b17f-47c728632654';
const request=(handler,action,body,cookie='session-a')=>handler(new Request('https://studio.test/api/images?action='+action,{method:body?'POST':'GET',headers:{Origin:'https://studio.test',Cookie:'__Host-jbp-session='+cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));
async function setup(config={}){
 const db=new PGlite();for(const path of ['../schema.sql','../migrations/estimated-token-quota.sql','../image-schema.sql','../migrations/mac-image-worker.sql'])await db.exec(await readFile(new URL(path,import.meta.url),'utf8'));
 const query=async(sql,params=[])=>(await db.query(sql,params)).rows;
 await query("INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES ('a','13900000000','甲','unused','user',0)");
 await query('INSERT INTO studio_sessions VALUES($1,$2,1,$3)',[hash('session-a'),'a',Date.now()+1000000]);
 return {db,query,handler:createImageHandler(query,{key:'test-key',...config})};
}

test('图片配置只接受专用密钥或显式通用base，不从通用密钥猜路由',()=>{
 assert.deepEqual(imageServerConfig({XAI_API_KEY:'live-key'}),{execution:'mac',key:'',baseUrl:'',model:''});
 assert.equal(imageServerConfig({JBP_IMAGE_EXECUTION:'direct',AI_API_KEY:'generic-secret'}).key,'');
 assert.equal(imageServerConfig({JBP_IMAGE_EXECUTION:'direct',AI_API_KEY:'generic-secret',AI_BASE_URL:'http://localhost:8000/v1'}).key,'');
 assert.equal(imageServerConfig({JBP_IMAGE_EXECUTION:'direct',AI_API_KEY:'generic-secret',AI_BASE_URL:'https://gateway.example/v1',AI_IMAGE_MODEL:'private-model'}).baseUrl,'https://gateway.example/v1');
 const dedicated=imageServerConfig({JBP_IMAGE_EXECUTION:'direct',AI_API_KEY:'generic-secret',AI_BASE_URL:'https://gateway.example/v1',XAI_API_KEY:'dedicated-secret',XAI_IMAGE_MODEL:'chosen'});
 assert.equal(dedicated.key,'dedicated-secret');assert.equal(dedicated.baseUrl,'https://api.x.ai/v1');assert.equal(dedicated.model,'chosen');
});

test('图片编码验证拒绝伪造MIME、任意URL、越界和非规范base64',()=>{
 const valid=validateImageData(PNG);assert.equal(valid.width,1);assert.equal(valid.height,1);assert.equal(valid.mime,'image/png');
 for(const value of ['https://internal.example/image.png',PNG.replace('image/png','image/jpeg'),PNG.replace('image/png','image/svg+xml'),PNG+'\n',PNG.replace('base64,','base64, '),'data:image/png;base64,abcd'])assert.throws(()=>validateImageData(value));
 assert.throws(()=>validateImageData(PNG,4),e=>e.status===413);
 const huge=Buffer.from(valid.buffer);huge.writeUInt32BE(16384,16);huge.writeUInt32BE(16384,20);assert.throws(()=>validateImageData('data:image/png;base64,'+huge.toString('base64')));
 assert.equal(IMAGE_LIMITS.referenceLimit,3);
});

test('服务端只索取base64原件、不跟随图片URL或重试，公开状态不泄露配置',async()=>{
 const calls=[];const s=await setup({model:'hidden-private-model',baseUrl:'https://configured.example/v1',fetcher:async(url,options)=>{calls.push({url,options});return Response.json({data:[{b64_json:PNG.split(',')[1]}]})}});
 try{
  const status=await (await request(s.handler,'status')).json();assert.equal(status.configured,true);assert.doesNotMatch(JSON.stringify(status),/test-key|hidden-private-model|configured\.example/);
  const data={requestId:reqId,kind:'角色',prompt:'中国女性角色设定',ratio:'9:16',resolution:'1K',references:[{dataUrl:PNG}]};
  const response=await request(s.handler,'generate',data);assert.equal(response.status,201);const result=await response.json();assert.equal(result.job.status,'done');assert.equal(result.wallet.used,2000);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://configured.example/v1/images/edits');assert.equal(calls[0].options.redirect,'error');const body=JSON.parse(calls[0].options.body);assert.equal(body.response_format,'b64_json');assert.equal(body.image.url,PNG);assert.equal(body.resolution,'1k');
  assert.doesNotMatch(JSON.stringify(result),/test-key|hidden-private-model|configured\.example|session_hash|data_url|owner/);
  assert.equal((await (await request(s.handler,'generate',data)).json()).item.id,result.item.id);assert.equal(calls.length,1);
  const original=await request(s.handler,'content&id='+result.item.id+'&download=1');assert.equal(original.status,200);assert.equal(original.headers.get('Content-Type'),'image/png');assert.match(original.headers.get('Content-Disposition'),/^attachment/);assert.deepEqual(Buffer.from(await original.arrayBuffer()),validateImageData(PNG).buffer);
 }finally{await s.db.close()}
});

test('返回URL或成功响应损坏保持待核对，密钥与上游原始错误不回传',async()=>{
 const s=await setup({fetcher:async()=>Response.json({data:[{url:'https://secret-upstream.example/private.png'}],provider:'private'})});
 try{const response=await request(s.handler,'generate',{requestId:reqId,kind:'分镜',prompt:'一场戏'}),r=await response.json();assert.equal(response.status,201);assert.equal(r.job.status,'uncertain');assert.equal(r.wallet.held,2000);assert.equal(r.item,undefined);assert.doesNotMatch(JSON.stringify(r),/upstream|private|test-key|provider/)}finally{await s.db.close()}
});

test('未配置时禁生成但可免费导入，严格拒绝身份与远程来源字段',async()=>{
 const s=await setup({key:''});
 try{
  assert.equal((await (await request(s.handler,'status')).json()).configured,false);
  assert.equal((await request(s.handler,'generate',{requestId:reqId,kind:'场景',prompt:'外景'})).status,409);
  const imported=await request(s.handler,'import',{requestId:reqId,kind:'场景',name:'书房',dataUrl:PNG,sourceId:'old:1'});assert.equal(imported.status,201);const saved=await imported.json();assert.equal(saved.item.source,'imported');assert.equal(saved.wallet.used,0);assert.equal(saved.wallet.held,0);
  const entries=await s.query('SELECT * FROM studio_quota_entries');assert.equal(entries.length,0);
  const aliasId='72d885b0-13c0-43ef-b17f-47c728632654',alias={requestId:aliasId,kind:'场景',name:'书房',dataUrl:PNG,sourceId:'old:1'};
  assert.equal((await (await request(s.handler,'import',alias)).json()).item.id,saved.item.id);
  assert.equal((await request(s.handler,'import',{...alias,sourceId:'other-source'})).status,409);
  assert.equal((await s.query('SELECT * FROM studio_images')).length,1);
  for(const extra of [{owner:'other'},{user_id:'other'},{password_hash:'not-uploaded'},{image_url:'https://private.example/x'}])assert.equal((await request(s.handler,'import',{requestId:reqId,kind:'道具',dataUrl:PNG,...extra})).status,400);
  assert.equal((await request(s.handler,'list&owner=other')).status,400);
 }finally{await s.db.close()}
});

test('模型HTTP拒绝释放预占，超时与服务器错误保留待核对且不会重试',async()=>{
 const statuses=[400,408,503],s=await setup({fetcher:async()=>Response.json({error:{message:'private-provider-account-key'}},{status:statuses[calls++]})});let calls=0;
 try{
  for(let i=0;i<statuses.length;i++){
   const data={requestId:`71d885b0-13c0-43ef-b17f-47c72863265${i}`,kind:'道具',prompt:'一把钥匙'},result=await (await request(s.handler,'generate',data)).json();
   assert.equal(result.job.status,i===0?'failed':'uncertain');assert.equal(result.wallet.used,0);assert.equal(result.wallet.held,2000*i);assert.doesNotMatch(JSON.stringify(result),/private-provider-account-key/);
   await request(s.handler,'generate',data);assert.equal(calls,i+1);
  }
 }finally{await s.db.close()}
});

test('待核对任务刷新后恢复，管理员结算只解除额度待核对而不冒充成片',async()=>{
 const s=await setup({generate:async()=>{throw new Error('transport-interrupted')}});
 try{
  for(const [i,op] of ['charge','release'].entries()){
   const data={requestId:`81d885b0-13c0-43ef-b17f-47c72863265${i}`,kind:'角色',prompt:'同一人物'},first=await (await request(s.handler,'generate',data)).json();
   assert.equal(first.job.status,'uncertain');assert.equal(first.job.needsReview,true);
   let status=await (await request(s.handler,'status')).json();assert.equal(status.jobs.find(j=>j.id===first.job.id).needsReview,true);
   await s.query("SELECT studio_quota_change($1,$2,$3,'image',$4,'', $5)",['a','media:image:'+data.requestId,op,op==='charge'?2000:0,Date.now()]);
   status=await (await request(s.handler,'status')).json();const reviewed=status.jobs.find(j=>j.id===first.job.id);
   assert.equal(reviewed.needsReview,false);assert.equal(reviewed.status,'uncertain');assert.equal(reviewed.error,'管理员已核对额度，生成结果仍待确认');assert.equal(reviewed.itemId,undefined);
   const replay=await (await request(s.handler,'generate',data)).json();assert.equal(replay.job.needsReview,false);assert.equal(replay.job.status,'uncertain');assert.equal(replay.item,undefined);
   assert.doesNotMatch(JSON.stringify(status),/quota_state|media:image:|session_hash/);
   const unavailableLedger=createImageHandler(async(sql,params)=>{if(sql.startsWith('SELECT state FROM studio_quota_entries'))throw new Error('ledger-unavailable');return s.query(sql,params)},{key:'test',generate:async()=>{throw new Error('must-not-call')}});
   const conservative=await (await request(unavailableLedger,'generate',data)).json();assert.equal(conservative.job.needsReview,true);assert.equal(conservative.job.status,'uncertain');
  }
 }finally{await s.db.close()}
});

test('运行中的任务始终需要核对，旧的未解决任务不被最近30条历史挤掉',async()=>{
 let entered,finish;const started=new Promise(resolve=>entered=resolve),s=await setup({generate:async()=>{entered();return new Promise(resolve=>finish=resolve)}});
 try{
  const pending=request(s.handler,'generate',{requestId:reqId,kind:'分镜',prompt:'一场跟拍'});await started;
  let status=await (await request(s.handler,'status')).json();assert.equal(status.jobs[0].status,'running');assert.equal(status.jobs[0].needsReview,true);
  await s.query("SELECT studio_quota_change($1,$2,'release','image',0,'',$3)",['a','media:image:'+reqId,Date.now()]);
  status=await (await request(s.handler,'status')).json();assert.equal(status.jobs[0].needsReview,true);
  finish({dataUrl:PNG});const late=await (await pending).json();assert.equal(late.job.status,'uncertain');assert.equal(late.job.needsReview,false);assert.equal(late.item,undefined);
  const uncertainData={requestId:'91d885b0-13c0-43ef-b17f-47c728632654',kind:'道具',prompt:'未完成任务'};
  const other=createImageHandler(s.query,{key:'test',generate:async()=>{throw new Error('lost')}}),old=await (await request(other,'generate',uncertainData)).json();
  for(let i=0;i<31;i++)await s.query("INSERT INTO studio_image_jobs(id,owner,request_key,input_hash,session_hash,session_version,project_id,project_title,name,asset_kind,prompt,ratio,resolution,status,amount,created,updated) VALUES($1,'a',$1,'hash','session',1,'image-library','图片库','历史','角色','旧稿','9:16','1k','failed',2000,$2,$2)",['history-'+i,Date.now()+i+1000]);
  status=await (await request(s.handler,'status')).json();assert.equal(status.jobs.length,31);assert.equal(status.jobs.find(j=>j.id===old.job.id).needsReview,true);
 }finally{await s.db.close()}
});
