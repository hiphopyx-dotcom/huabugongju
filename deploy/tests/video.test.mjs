import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {createVideoHandler,buildVeoRequest} from '../lib/video.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const sampleUri='https://generativelanguage.googleapis.com/v1beta/files/sample:download?alt=media';
function setup({apiKey='mock-gemini-key'}={}){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const sql=async(query,params)=>db.prepare(query).all(Object.fromEntries(params.map((p,i)=>['$'+(i+1),typeof p==='boolean'?Number(p):p])));
 let now=Date.now(),started=0,polled=0,seen=[],failStart=false;
 const fakeFetch=async(url,options)=>{
  const target=String(url),method=options?.method||'GET';
  seen.push({url:target,method,headers:options?.headers,payload:options?.body?JSON.parse(options.body):null});
  if(method==='POST'&&target.includes(':predictLongRunning')){
    started++;
    if(failStart)throw Error('Connection lost after request');
    return Response.json({name:'models/veo-3.1-fast-generate-preview/operations/test-123'});
  }
  if(target.includes('/operations/test-123')){
    polled++;
    return Response.json(polled>1?{done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:sampleUri}}]}}}:{done:false});
  }
  if(target===sampleUri)return new Response(new Uint8Array([0,0,0,20,102,116,121,112]),{status:200,headers:{'Content-Type':'video/mp4','Content-Length':'8'}});
  return Response.json({error:'unknown'}, {status:500});
 };
 const accounts=createAccountHandler(sql,{setupToken:'test-setup'});
 const video=createVideoHandler(sql,{now:()=>now,apiKey,fetch:fakeFetch,dailyLimit:6});
 const call=(fn,action,body,auth='',method=body?'POST':'GET',qs='')=>
  fn(new Request('https://studio.test/api/'+(fn===accounts?'accounts':'video')+'?action='+action+qs,{
    method,headers:{Origin:'https://studio.test',Cookie:auth,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined}));
 return {db,video,accounts,call,account:(...args)=>call(accounts,...args),request:(...args)=>call(video,...args),
  advance:n=>now+=n,calls:seen,stats:()=>({started,polled}),fail:()=>failStart=true};
}
async function admin(s){
 const r=await s.account('bootstrap',{setupToken:'test-setup',phone:'13800000000',name:'管理员',password:'12345678'});
 assert.equal(r.status,201);
 return r.headers.get('set-cookie').split(';')[0];
}
const input={projectId:'project1',requestId:'request-12345678',shotId:'shot01',shotLabel:'镜头1',prompt:'人物在一间古老的书房中抬起头，固定服装和发型，缓缓推进。',model:'veo-3.1-fast-generate-preview',mode:'start',first:png,refs:[],referenceIds:['ref1'],ratio:'9:16'};
test('Veo REST request preserves first/last frame semantics and character references',()=>{
 const a=buildVeoRequest({...input,mode:'interpolate',last:png});
 assert.equal(a.instances[0].image.inlineData.mimeType,'image/png');
 assert.equal(a.instances[0].lastFrame.inlineData.data,png.split(',')[1]);
 assert.equal(a.parameters.durationSeconds,'8');
 assert.equal(a.parameters.aspectRatio,'9:16');
 assert.equal(a.parameters.personGeneration,'allow_adult');
 const b=buildVeoRequest({...input,mode:'references',first:'',refs:[png,png]});
 assert.equal(b.instances[0].referenceImages.length,2);
 assert.equal(b.instances[0].image,undefined);
 assert.throws(()=>buildVeoRequest({...input,mode:'interpolate',last:''}),/首尾帧/);
 assert.throws(()=>buildVeoRequest({...input,ratio:'1:1'}),/画幅|支持/);
});
test('submits once, never bills on duplicate key; probes and downloads authenticated video',async()=>{
 const s=setup(),auth=await admin(s);
 let response=await s.request('start',input,auth);
 assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
 const j=(await response.json()).job;assert.equal(j.status,'queued');
 assert.equal(s.stats().started,1);
 response=await s.request('start',input,auth);
 assert.equal(response.status,200);
 assert.equal((await response.json()).duplicate,true);
 assert.equal(s.stats().started,1);
 response=await s.request('start',{...input,prompt:'different prompt'},auth);
 assert.equal(response.status,409);
 s.advance(6000);response=await s.request('poll',{id:j.id},auth);
 assert.equal((await response.json()).job.status,'running');
 s.advance(6000);response=await s.request('poll',{id:j.id},auth);
 const updated=(await response.json()).job;
 assert.equal(updated.status,'succeeded');assert.equal(updated.downloadable,true);
 const download=await s.request('download',null,auth,'GET','&id='+j.id);
 assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'video/mp4');
 assert.equal((await download.arrayBuffer()).byteLength,8);
 assert.equal(s.stats().started,1);
 assert.ok(!JSON.stringify(updated).includes(sampleUri),'private video URL must not leak to browser job list');
});
test('anonymous and cross-origin users cannot start paid videos or download files',async()=>{
 const s=setup();let response=await s.request('start',input);
 assert.equal(response.status,401);
 const auth=await admin(s);
 const evil=new Request('https://studio.test/api/video?action=start',{method:'POST',
  headers:{Origin:'https://attacker.invalid',Cookie:auth,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await s.video(evil)).status,403);
 const started=await (await s.request('start',input,auth)).json();
 const memberResponse=await s.account('users',{phone:'13900000000',name:'新成员',password:'12345678'},auth);
 assert.equal(memberResponse.status,201);
 const logged=await s.account('login',{phone:'13900000000',password:'12345678'});
 const member=logged.headers.get('set-cookie').split(';')[0];
 assert.equal((await s.request('poll',{id:started.job.id},member)).status,404);
 assert.equal((await s.request('download',null,member,'GET','&id='+started.job.id)).status,404);
 assert.deepEqual((await (await s.request('jobs',null,member,'GET','&projectId=project1')).json()).jobs,[]);
});
test('an ambiguous submit outcome is NOT silently retried, and missing API key blocks billing',async()=>{
 const s=setup(),auth=await admin(s);s.fail();
 const r=await s.request('start',input,auth);
 assert.equal(r.status,502);
 assert.equal(s.stats().started,1);
 const jobs=await (await s.request('jobs',null,auth,'GET','&projectId=project1')).json();
 assert.equal(jobs.jobs[0].status,'uncertain');
 assert.equal((await s.request('start',input,auth)).status,200);
 assert.equal(s.stats().started,1);
 const noKey=setup({apiKey:''}),noKeyAuth=await admin(noKey);
 assert.equal((await noKey.request('start',input,noKeyAuth)).status,503);
 assert.equal(noKey.stats().started,0);
});
test('download URLs may only come from allowlisted Google video hosts',async()=>{
 const s=setup(),auth=await admin(s);
 const job=(await (await s.request('start',input,auth)).json()).job;
 s.db.prepare("UPDATE studio_video_jobs SET status='succeeded',output_uri=$uri WHERE id=$id").run({$uri:'https://127.0.0.1/private/secret',$id:job.id});
 const denied=await s.request('download',null,auth,'GET','&id='+job.id);
 assert.notEqual(denied.status,200);
});

test('crashed status poll can recover after 90 seconds without new paid generation',async()=>{
 const s=setup(),auth=await admin(s);
 const job=(await (await s.request('start',input,auth)).json()).job;
 s.db.prepare("UPDATE studio_video_jobs SET status='polling',updated=$at WHERE id=$id").run({$at:Date.now()-100000,$id:job.id});
 s.advance(1000);
 const reset=await s.request('poll',{id:job.id},auth);
 assert.equal(reset.status,200);
 assert.equal((await reset.json()).job.status,'running');
 assert.equal(s.stats().started,1);
 s.advance(6000);
 const probe=await s.request('poll',{id:job.id},auth);
 assert.equal(probe.status,200);
 assert.equal(s.stats().polled,1);
 assert.equal(s.stats().started,1);
});
