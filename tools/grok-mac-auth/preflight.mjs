import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {validateConnection} from './worker.mjs';
import {profileId} from './core.mjs';
import {verifyIdentity} from './identity.mjs';

const ORIGIN='https://jubaopeng-canvas.vercel.app';

async function ordinaryFile(file,limit){
 const before=await fs.lstat(file);
 if(!before.isFile()||before.size>limit)throw Error('unsafe file');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('unsafe file');
  const buffer=Buffer.alloc(limit+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
  if(bytesRead>limit)throw Error('oversize file');
  return buffer.subarray(0,bytesRead).toString('utf8');
 }finally{await handle.close()}
}

async function endpoint(url,fetchImpl,timeoutMs){
 const controller=new AbortController();let timer;
 try{
  const response=await Promise.race([
   fetchImpl(url,{method:'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json, text/html'},signal:controller.signal}),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'))},timeoutMs)})
  ]);
  // Only status is needed; never parse a login page or a response containing account data.
  if(response.body)void response.body.cancel().catch(()=>{});
  if(response.redirected)return {reached:false,ok:false,code:'HTTP_ERROR'};
  if(response.status===401)return {reached:true,ok:false,code:'LOGIN_REQUIRED'};
  return response.status===200?{reached:true,ok:true,code:'REACHABLE'}:{reached:false,ok:false,code:'HTTP_ERROR'};
 }catch{return {reached:false,ok:false,code:controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR'}}
 finally{clearTimeout(timer);controller.abort()}
}

export async function checkConnection(root,configFile,{fetchImpl=fetch,timeoutMs=8000}={}){
 const report={localReady:false,siteReachable:false,billingSource:'unverified',checks:[]};
 const add=(name,ok,code)=>report.checks.push({name,ok,code});
 let raw,config,label;
 try{
  if(typeof configFile!=='string'||typeof root!=='string')throw Error('invalid path');
  raw=JSON.parse(await ordinaryFile(configFile,16384));config=validateConnection(raw);
  if(raw.localLabel!==undefined&&typeof raw.localLabel!=='string')throw Error('invalid local label');
  label=raw.localLabel||config.grokLabel;profileId(label);
 }catch{add('config',false,'CONFIG_INVALID');return report}
 add('config',true,'CONFIG_VALID');
 try{
  const home=path.join(root,'profiles',profileId(label));
  for(const directory of [root,path.join(root,'profiles'),home]){
   if(!(await fs.lstat(directory)).isDirectory())throw Error('unsafe directory');
  }
  await ordinaryFile(path.join(home,'auth.json'),1024*1024);
  await verifyIdentity({home,label},config.grokLabel);
 }catch{add('identity',false,'IDENTITY_INVALID');return report}
 add('identity',true,'IDENTITY_MATCHED');
 try{
  const runtime=await fs.realpath(path.join(root,'runtime'));
  const binary=await fs.realpath(path.join(root,'runtime/node_modules/.bin/grok'));
  const relative=path.relative(runtime,binary);
  if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)||!(await fs.stat(binary)).isFile())throw Error('unsafe binary');
  await fs.access(binary,constants.X_OK);
 }catch{add('cli',false,'CLI_MISSING');return report}
 add('cli',true,'CLI_PRESENT');report.localReady=true;
 const duration=Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000?timeoutMs:8000;
 const site=await endpoint(ORIGIN+'/',fetchImpl,duration);add('site',site.ok,site.code);
 const api=await endpoint(ORIGIN+'/api/generation?action=status',fetchImpl,duration);add('generationEndpoint',api.ok,api.code);
 report.siteReachable=site.ok&&api.reached;
 return report;
}
