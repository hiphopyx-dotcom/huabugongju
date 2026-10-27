import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkConnection} from './preflight.mjs';

const ORIGIN='https://jubaopeng-canvas.vercel.app';
const secret='q'.repeat(43),email='private-owner@example.test';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-preflight-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'profiles',createHash('sha256').update(email).digest('hex'));
 const binary=path.join(root,'runtime/node_modules/.bin/grok');
 await fs.mkdir(home,{recursive:true});await fs.mkdir(path.dirname(binary),{recursive:true});
 await fs.writeFile(binary,'#!/bin/sh\nexit 99\n',{mode:0o700});
 const auth=path.join(home,'auth.json');
 await fs.writeFile(auth,JSON.stringify({'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828':{email,user_id:'private-user-id',access_token:'never-disclose'}}));
 const config={format:'jbp-mac-text-worker-v1',origin:ORIGIN,grokAccountId:'11111111-1111-4111-8111-111111111111',grokLabel:email,localLabel:email,workerToken:secret};
 const file=path.join(root,'connection.json');await fs.writeFile(file,JSON.stringify(config));
 return {root,home,binary,auth,config,file};
}

test('preflight rejects unsafe configuration before making requests',async t=>{
 const f=await fixture(t);let calls=0;
 const fetchImpl=async()=>{calls++;throw Error('must not fetch')};
 for(const value of ['{',JSON.stringify({...f.config,origin:'https://evil.test'}),JSON.stringify({...f.config,workerToken:'short'}),JSON.stringify({...f.config,localLabel:17}),' '.repeat(16385)]){
  await fs.writeFile(f.file,value);const result=await checkConnection(f.root,f.file,{fetchImpl});
  assert.equal(result.localReady,false);assert.equal(result.siteReachable,false);
  assert.ok(result.checks.some(c=>c.code==='CONFIG_INVALID'));assert.equal(calls,0);
 }
 await fs.writeFile(f.file,JSON.stringify(f.config));const link=path.join(f.root,'linked.json');await fs.symlink(f.file,link);
 assert.equal((await checkConnection(f.root,link,{fetchImpl})).localReady,false);assert.equal(calls,0);
});

test('preflight uses the configured local profile and does not create login directories',async t=>{
 const f=await fixture(t);let calls=0;const fetchImpl=async()=>{calls++;return new Response('',{status:200})};
 await fs.writeFile(f.file,JSON.stringify({...f.config,localLabel:'missing-profile'}));
 let result=await checkConnection(f.root,f.file,{fetchImpl});
 assert.equal(result.localReady,false);assert.equal(calls,0);
 const missing=path.join(f.root,'profiles',createHash('sha256').update('missing-profile').digest('hex'));
 await assert.rejects(fs.stat(missing),{code:'ENOENT'});
 await fs.writeFile(f.file,JSON.stringify(f.config));
 await fs.writeFile(f.auth,JSON.stringify({'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828':{email:'another@example.test',user_id:'other'}}));
 result=await checkConnection(f.root,f.file,{fetchImpl});assert.equal(result.localReady,false);assert.equal(calls,0);
 assert.ok(result.checks.some(c=>c.code==='IDENTITY_INVALID'));
});

test('preflight rejects linked identity files and profile directories',async t=>{
 const f=await fixture(t),backup=path.join(f.root,'backup-auth.json');await fs.rename(f.auth,backup);await fs.symlink(backup,f.auth);
 const fetchImpl=async()=>{assert.fail('unsafe identity must not fetch')};
 assert.equal((await checkConnection(f.root,f.file,{fetchImpl})).localReady,false);
 await fs.unlink(f.auth);await fs.rename(backup,f.auth);
 const moved=f.home+'-moved';await fs.rename(f.home,moved);await fs.symlink(moved,f.home);
 assert.equal((await checkConnection(f.root,f.file,{fetchImpl})).localReady,false);
});

test('preflight never equates unauthenticated reachability with generation availability',async t=>{
 const f=await fixture(t),requests=[],before=await fs.readFile(f.auth,'utf8');
 const result=await checkConnection(f.root,f.file,{fetchImpl:async(url,options)=>{
  requests.push({url,options});return new Response('',{status:requests.length===1?200:401});
 }});
 assert.equal(result.localReady,true);assert.equal(result.siteReachable,true);
 assert.equal(result.billingSource,'unverified');assert.equal(result.generationReady,undefined);
 assert.ok(result.checks.some(c=>c.code==='LOGIN_REQUIRED'&&!c.ok));
 assert.deepEqual(requests.map(r=>r.url),[ORIGIN+'/',ORIGIN+'/api/generation?action=status']);
 for(const {options} of requests){assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).has('Authorization'),false);assert.equal(options.body,undefined)}
 for(const value of [email,secret,'private-user-id','never-disclose',f.root])assert.equal(JSON.stringify(result).includes(value),false);
 assert.equal(await fs.readFile(f.auth,'utf8'),before);
});

test('preflight reports timeout and does not disclose network errors',async t=>{
 const f=await fixture(t);
 const result=await checkConnection(f.root,f.file,{timeoutMs:15,fetchImpl:()=>new Promise(()=>{})});
 assert.equal(result.localReady,true);assert.equal(result.siteReachable,false);
 assert.ok(result.checks.some(c=>c.code==='TIMEOUT'));
 const failed=await checkConnection(f.root,f.file,{fetchImpl:async()=>{throw Error(email+secret)}});
 assert.equal(failed.siteReachable,false);assert.equal(JSON.stringify(failed).includes(secret),false);
});

test('preflight rejects redirected and unavailable endpoints',async t=>{
 const f=await fixture(t);
 for(const status of [302,404,503]){
  const result=await checkConnection(f.root,f.file,{fetchImpl:async()=>new Response('',{status})});
  assert.equal(result.siteReachable,false);assert.ok(result.checks.some(c=>c.code==='HTTP_ERROR'));
 }
});

test('preflight distinguishes a missing CLI without executing a binary',async t=>{
 const f=await fixture(t);await fs.unlink(f.binary);
 const result=await checkConnection(f.root,f.file,{fetchImpl:async()=>assert.fail('incomplete local installation must not fetch')});
 assert.equal(result.localReady,false);assert.ok(result.checks.some(c=>c.code==='CLI_MISSING'));
});
