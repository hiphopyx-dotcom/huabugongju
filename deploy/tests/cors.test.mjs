import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {allowedOrigins,applyCors,hash,preflight,withCors,BEARER_SESSION_MS,DEFAULT_CORS_ORIGIN} from '../lib/security.mjs';

const ZINC='https://zinc-raven-rocket-drift.grok.me';
const read=(name)=>fs.readFileSync(new URL(name,import.meta.url),'utf8');

function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  const query=async(sql,p)=>{const stmt=db.prepare(sql);return stmt.all(Object.fromEntries(p.map((v,i)=>['$'+(i+1),typeof v==='boolean'?Number(v):v])))};
  const handler=withCors(createAccountHandler(query,{setupToken:'test-setup-secret-with-32-characters'}));
  const call=(action,method,data,headers={})=>handler(new Request('https://studio.test/api/accounts?action='+action,{method,headers:{'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined}));
  return {db,call};
}

test('默认白名单只有预览源，精确匹配，拒绝通配和带路径的覆盖',()=>{
  assert.deepEqual([...allowedOrigins({})],[DEFAULT_CORS_ORIGIN]);
  assert.equal(allowedOrigins({JBP_CORS_ORIGINS:'https://studio.example'}).has(ZINC),false);
  assert.equal(allowedOrigins({JBP_CORS_ORIGINS:'https://studio.example'}).has('https://studio.example'),true);
  assert.throws(()=>allowedOrigins({JBP_CORS_ORIGINS:'https://*.grok.me'}));
  assert.throws(()=>allowedOrigins({JBP_CORS_ORIGINS:'https://zinc-raven-rocket-drift.grok.me/bench'}));
  assert.equal(allowedOrigins({}).has('https://zinc-raven-rocket-drift.grok.me.evil.example'),false);
});

test('预检只放行白名单源',()=>{
  const ok=preflight(new Request('https://studio.test/api/accounts',{method:'OPTIONS',headers:{Origin:ZINC}}));
  assert.equal(ok.status,204);
  assert.equal(ok.headers.get('access-control-allow-origin'),ZINC);
  assert.equal(ok.headers.get('access-control-allow-headers'),'Content-Type, Authorization');
  assert.equal(ok.headers.get('access-control-allow-credentials'),null);
  assert.match(ok.headers.get('vary'),/Origin/);
  for(const origin of ['https://evil.example','https://zinc-raven-rocket-drift.grok.me.evil.example']){
    const denied=preflight(new Request('https://studio.test/api/accounts',{method:'OPTIONS',headers:{Origin:origin}}));
    assert.equal(denied.status,403);
    assert.equal(denied.headers.get('access-control-allow-origin'),null);
  }
});

test('同源 cookie 登录不变；跨域签发 24 小时 Bearer，且不写 cookie',async()=>{
  const s=setup();
  const boot=await s.call('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13800000000',password:'administrator-password',name:'管理员'},{Origin:'https://studio.test'});
  assert.equal(boot.status,201);
  assert.match(boot.headers.get('set-cookie'),/__Host-jbp-session=/);
  const same=await s.call('login','POST',{phone:'13800000000',password:'administrator-password',client:'bearer'},{Origin:'https://studio.test'});
  const sameBody=await same.json();
  assert.equal(same.status,200);
  assert.match(same.headers.get('set-cookie'),/Max-Age=604800/);
  assert.equal(sameBody.token,undefined);
  const cross=await s.call('login','POST',{phone:'13800000000',password:'administrator-password',client:'bearer'},{Origin:ZINC});
  const body=await cross.json();
  assert.equal(cross.status,200);
  assert.equal(cross.headers.get('set-cookie'),null);
  assert.equal(cross.headers.get('access-control-allow-origin'),ZINC);
  assert.equal(body.token.length,43);
  assert.ok(body.expires<=Date.now()+BEARER_SESSION_MS+1000&&body.expires>=Date.now()+BEARER_SESSION_MS-5000);
  const row=s.db.prepare('SELECT expires FROM studio_sessions WHERE token_hash=?').get(hash(body.token));
  assert.equal(Number(row.expires),body.expires);
  const me=await s.call('me','GET',null,{Origin:ZINC,Authorization:'Bearer '+body.token});
  assert.equal((await me.json()).user.role,'admin');
  assert.equal(me.headers.get('access-control-allow-origin'),ZINC);
  const cookieOnly=await s.call('logout','POST',{},{Origin:ZINC,Cookie:'__Host-jbp-session='+body.token});
  assert.equal(cookieOnly.status,403);
  assert.equal(cookieOnly.headers.get('access-control-allow-origin'),ZINC);
  const admin=await s.call('grok-accounts','POST',{label:'主账户'},{Origin:ZINC,Authorization:'Bearer '+body.token});
  assert.equal(admin.status,403);
  assert.match((await admin.json()).error,/正式版网站/);
  const evil=await s.call('login','POST',{phone:'13800000000',password:'administrator-password',client:'bearer'},{Origin:'https://evil.example'});
  assert.equal(evil.status,403);
  assert.equal(evil.headers.get('access-control-allow-origin'),null);
  s.db.close();
});

test('未登录的跨域错误响应也带 CORS，出图工作端和单点登录不开放',async()=>{
  const s=setup();
  const me=await s.call('me','GET',null,{Origin:ZINC});
  assert.equal(me.status,200);
  assert.equal(me.headers.get('access-control-allow-origin'),ZINC);
  const denied=await applyCors(new Request('https://studio.test/api/accounts',{headers:{Origin:'https://evil.example'}}),Response.json({error:'请先登录'},{status:401}));
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
  for(const file of ['../api/image-worker.js','../api/sso.js']){
    const source=read(file);
    assert.doesNotMatch(source,/withCors|Access-Control-Allow-Origin/);
  }
  for(const file of ['../api/accounts.js','../api/images.js','../api/generation.js','../api/quota.js','../api/assets.js','../api/collaboration.js','../api/pianchang-video.js']){
    assert.match(read(file),/withCors/);
    assert.match(read(file),/OPTIONS/);
  }
  s.db.close();
});
