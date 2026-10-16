import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {profileId,prepareProfile,childEnvironment,testArgs} from './core.mjs';
test('不同账户隔离目录，拒绝空名称且不接受路径穿越',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'jbp-auth-'));try{assert.throws(()=>profileId(''));const a=await prepareProfile(root,'主账户'),b=await prepareProfile(root,'../备用账户');assert.notEqual(a.home,b.home);assert.ok(b.home.startsWith(root+path.sep));assert.equal((await fs.stat(a.home)).mode&0o777,0o700);assert.equal(await fs.readFile(path.join(a.home,'AGENTS.md'),'utf8').catch(()=>null),null)}finally{await fs.rm(root,{recursive:true,force:true})}});
test('运行环境不继承API密钥、原授权目录和外部认证命令',()=>{const env=childEnvironment('/private/profile',{PATH:'/bin',HOME:'/Users/demo',XAI_API_KEY:'secret',GROK_HOME:'/other',GROK_AUTH_PROVIDER_COMMAND:'echo secret',GROK_CLI_CHAT_PROXY_BASE_URL:'https://other',OTHER_TOKEN:'secret'});assert.equal(env.HOME,'/Users/demo');assert.equal(env.GROK_HOME,'/private/profile');assert.equal(env.XAI_API_KEY,undefined);assert.equal(env.GROK_AUTH_PROVIDER_COMMAND,undefined);assert.equal(env.OTHER_TOKEN,undefined);assert.ok(!testArgs.includes('--always-approve'));assert.equal(testArgs[testArgs.indexOf('--tools')+1],'')});
