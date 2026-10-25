import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateConfig,textArgs,workerEnvironment,executeText} from './worker.mjs';
test('工作端固定正式站点、官方登录、工具隔离且不继承API密钥',()=>{
 const c={format:'jbp-mac-script-worker-v1',origin:'https://jubaopeng-canvas.vercel.app',accountId:'11111111-1111-4111-8111-111111111111',workerToken:'A'.repeat(43)};
 assert.equal(validateConfig(c),c);assert.throws(()=>validateConfig({...c,origin:'https://example.com'}));
 const args=textArgs();for(const required of ['--ignore-user-config','--ephemeral','read-only','forced_login_method="chatgpt"','tools.view_image=false','model_provider="openai"'])assert.ok(args.includes(required));
 assert.deepEqual(workerEnvironment({HOME:'/home/test',PATH:'/bin',OPENAI_API_KEY:'secret',CODEX_ACCESS_TOKEN:'secret',DATABASE_URL:'secret'}),{PATH:'/bin',HOME:'/home/test'});
});
test('任务通过stdin传入，仅读取最终回复，错误、空结果、超时不伪报成功',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-script-unit-')),binary=path.join(dir,'fixture');
 async function run(source,options){await fs.writeFile(binary,'#!/usr/bin/env node\n'+source,{mode:0o700});return executeText(binary,dir,'$(touch SHOULD_NOT_EXIST)\n剧本资料',options)}
 try{
  let result=await run("let p='';process.stdin.on('data',c=>p+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:p}}))})");
  assert.equal(result.result,'$(touch SHOULD_NOT_EXIST)\n剧本资料');assert.equal(await fs.stat(path.join(dir,'SHOULD_NOT_EXIST')).catch(()=>null),null);
  assert.deepEqual(await run('process.exit(1)'),{error:'CLI_ERROR'});
  assert.deepEqual(await run('process.exit(0)'),{error:'EMPTY_RESULT'});
  assert.deepEqual(await run('setTimeout(()=>{},10000)',{timeoutMs:25}),{error:'TIMEOUT'});
  result=await run("console.log(JSON.stringify({type:'turn.failed',error:{message:'private detail'}}))");assert.deepEqual(result,{error:'CLI_ERROR'});
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
