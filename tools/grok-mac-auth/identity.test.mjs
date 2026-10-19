import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyIdentity} from './identity.mjs';
import {startWorker} from './worker.mjs';
const key='https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828';
test('登录邮箱必须匹配本机和网站邮箱标识；不泄漏凭据',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-identity-'));const profile={home,label:'first@example.test'};
 try{
  await assert.rejects(verifyIdentity(profile,profile.label));
  await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({[key]:{email:'first@example.test',user_id:'user1',access_token:'DO_NOT_DISCLOSE'}}));
  assert.deepEqual(await verifyIdentity(profile,'FIRST@example.test'),{email:'first@example.test',userId:'user1'});
  await assert.rejects(verifyIdentity(profile,'second@example.test'),e=>!e.message.includes('DO_NOT_DISCLOSE'));
  await assert.rejects(verifyIdentity({...profile,label:'second@example.test'},'别名'));
  await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({[key]:{access_token:'DO_NOT_DISCLOSE'}}));
  await assert.rejects(verifyIdentity(profile,profile.label));
 }finally{await fs.rm(home,{recursive:true,force:true})}
});
test('错配账户启动时不得发送心跳、领取任务或调用模型',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-wrong-worker-'));const originalFetch=globalThis.fetch;let requests=0;
 try{
  const {prepareProfile}=await import('./core.mjs');const label='first@example.test',profile=await prepareProfile(root,label);
  await fs.writeFile(path.join(profile.home,'auth.json'),JSON.stringify({[key]:{email:'other@example.test',user_id:'other'}}));
  const binary=path.join(root,'runtime/node_modules/.bin/grok');await fs.mkdir(path.dirname(binary),{recursive:true});await fs.writeFile(binary,'not executable');
  await fs.mkdir(path.join(root,'connections'));const id='11111111-1111-4111-8111-111111111111';
  await fs.writeFile(path.join(root,'connections',id+'.json'),JSON.stringify({format:'jbp-mac-text-worker-v1',origin:'https://jubaopeng-canvas.vercel.app',grokAccountId:id,grokLabel:label,workerToken:'a'.repeat(43)}));
  globalThis.fetch=async()=>{requests++;throw Error('must not connect')};
  await assert.rejects(startWorker(root));assert.equal(requests,0);
 }finally{globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true})}
});
