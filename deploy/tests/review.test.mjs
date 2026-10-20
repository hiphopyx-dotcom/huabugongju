import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {createReviewHandler,localReviewRed,parseVerdict,reviewPasses} from '../lib/review.mjs';
import {createHash} from 'node:crypto';

const url='https://studio.test/api/review';
function environment({score=97,cap=15}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const query=async(statement,params)=>db.prepare(statement).all(Object.fromEntries(params.map((v,i)=>['$'+(i+1),typeof v==='boolean'?Number(v):v])));
  let now=Date.now(),calls=[];
  const accounts=createAccountHandler(query,{setupToken:'setup-test'});
  const writer=async(prompt,original)=>{
    calls.push({provider:'OpenAI',original});
    return original?'第1集\n1-1 车间 日 内\n人物：陆川 周宁\n△周宁递上账本。\n陆川：我已经查清账目。\n第1集完':
      '第1集\n1-1 车间 日 内\n人物：陆川 周宁\n△陆川翻开账本。\n周宁：账目有问题。\n第1集完';
  };
  const reviewer=async()=>{calls.push({provider:'Gemini'});return {score,strengths:['冲突清楚'],issues:[],hardFailures:[],revisionInstructions:[]}};
  const handler=createReviewHandler(query,{now:()=>now,writer,reviewer});
  const http=(fn,action,body,auth='',method=body?'POST':'GET',params='')=>{
    const target=(fn===accounts?'https://studio.test/api/accounts':url)+'?action='+action+params;
    return fn(new Request(target,{method,headers:{Origin:'https://studio.test',Cookie:auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
  };
  return {db,writer,calls,handler,account:(...args)=>http(accounts,...args),review:(...args)=>http(handler,...args),setNow:n=>now=n};
}
async function admin(s){
  const response=await s.account('bootstrap',{setupToken:'setup-test',phone:'13800000000',name:'管理员',password:'12345678'});
  assert.equal(response.status,201);
  return response.headers.get('set-cookie').split(';')[0];
}
const source='第1集\n1-1 车间 日 内\n人物：陆川 周宁\n△陆川放下茶杯。\n周宁：你查出来了？\n第1集完';
const hash=v=>createHash('sha256').update(v).digest('hex');
async function begin(s,auth,id='abcdefgh1234'){
  const result=await s.review('start',{projectId:'project_1',partKey:'第1集#1',requestId:id,source,reference:'90年代车间与财务舞弊，保留陆川、周宁。'},auth);
  assert.equal(result.status,201);
  return (await result.json()).run;
}
test('sessions are required and cross-origin mutation is rejected',async()=>{
  const s=environment();
  let r=await s.review('start',{projectId:'proj',partKey:'全文',requestId:'12345678',source,reference:'背景'});
  assert.equal(r.status,401);
  const auth=await admin(s);
  r=await s.handler(new Request(url+'?action=start',{method:'POST',headers:{Origin:'https://evil.example',Cookie:auth},body:'{}'}));
  assert.equal(r.status,403);
});
test('four distinct model stages persist and require manual human adoption',async()=>{
  const s=environment(),auth=await admin(s),run=await begin(s,auth);
  assert.equal(run.stage,'write');assert.equal(run.versions.length,0);
  const sequence=['review1','rewrite','review2','done'];
  for(const stage of sequence){
    const r=await s.review('advance',{id:run.id},auth);
    assert.equal(r.status,200);
    const actual=(await r.json()).run;
    assert.equal(actual.stage,stage);
  }
  const r=await s.review('status',null,auth,'GET','&id='+run.id);
  const data=(await r.json()).run;
  assert.equal(data.passed,true);
  assert.equal(data.score,97);
  assert.equal(data.versions.length,4);
  assert.deepEqual(s.calls.map(x=>x.provider),['OpenAI','Gemini','OpenAI','Gemini']);
  assert.equal((await s.review('adopt',{id:run.id,currentHash:'outdated'},auth)).status,409);
  const adopted=await s.review('adopt',{id:run.id,currentHash:hash(source)},auth);
  assert.equal(adopted.status,200);
  assert.ok((await adopted.json()).candidate.includes('我已经查清账目'));
  assert.equal((await (await s.review('status',null,auth,'GET','&id='+run.id)).json()).run.adopted,true);
});
test('95-point threshold prevents adopting rejected scripts',async()=>{
  const s=environment({score:94}),auth=await admin(s),run=await begin(s,auth,'request_low_score');
  for(let i=0;i<4;i++)assert.equal((await s.review('advance',{id:run.id},auth)).status,200);
  const state=(await (await s.review('status',null,auth,'GET','&id='+run.id)).json()).run;
  assert.equal(state.passed,false);
  assert.equal((await s.review('adopt',{id:run.id,currentHash:hash(source)},auth)).status,409);
});
test('request idempotency and cross-account isolation',async()=>{
  const s=environment(),auth=await admin(s),run=await begin(s,auth);
  const duplicate=await s.review('start',{projectId:'project_1',requestId:'abcdefgh1234',source,reference:'same'},auth);
  assert.equal((await duplicate.json()).run.id,run.id);
  assert.equal((await s.review('status',null,'','GET','&id='+run.id)).status,401);
  const extra=await s.account('users',{phone:'13900000000',name:'成员',password:'12345678'},auth);
  assert.equal(extra.status,201);
  const login=await s.account('login',{phone:'13900000000',password:'12345678'});
  const member=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await s.review('status',null,member,'GET','&id='+run.id)).json()).run,null);
  assert.equal((await s.review('advance',{id:run.id},member)).status,404);
});
test('local hard red lines and malformed rating cannot be accepted',()=>{
  assert.equal(localReviewRed('△陆川端杯。\n△周宁放下笔。\n周宁（低头抿嘴）：算你想得周全。'),2);
  assert.equal(reviewPasses({score:98,hardFailures:[]},'△A\n△B'),false);
  assert.equal(reviewPasses({score:96,hardFailures:['人物变更']},source),false);
  assert.throws(()=>parseVerdict('{"score":"99"}'),/格式/);
  assert.throws(()=>parseVerdict('{"score":99}'),/数组/);
});
