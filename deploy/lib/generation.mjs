import {memberError} from '../../public/studio/model-privacy.mjs';
import {randomUUID} from 'node:crypto';
import {AccountError,hash,token,cookie,safeOrigin,requireAdmin} from './security.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ERRORS={CLI_ERROR:'本机生成失败，请管理员检查登录或额度',EMPTY_RESULT:'模型没有返回文字',TIMEOUT:'本机生成超时，未自动重复调用',RESULT_TOO_LARGE:'生成结果过大，请缩短要求'};
const SCRIPT_HOST='语言模型写作主机';
const jobView=j=>({adminLocked:!!j.admin_locked,id:j.id,requestId:j.request_key,prompt:j.prompt,status:j.status,result:j.result||'',error:memberError(j.error||''),created:Number(j.created),updated:Number(j.updated)});
export function createGenerationHandler(query,config={}){return async req=>{try{
const url=new URL(req.url),action=url.searchParams.get('action')||'jobs',now=config.now?.()??Date.now();
const q=(s,...p)=>query(s,p),one=async(s,...p)=>(await q(s,...p))[0];
const bearer=req.headers.get('authorization');const workerAction=['poll','heartbeat','complete'].includes(action);
if(!workerAction||req.headers.has('origin'))safeOrigin(req);
let body={};if(req.method!=='GET'){const raw=await req.text();if(Buffer.byteLength(raw)>140000)throw new AccountError(413,'请求过大');try{body=JSON.parse(raw)}catch{throw new AccountError(400,'请求格式错误')}if(!body||Array.isArray(body)||typeof body!=='object')throw new AccountError(400,'请求格式错误')}
const validity="EXISTS (SELECT 1 FROM studio_accounts a JOIN studio_grok_accounts g ON g.id=studio_generation_jobs.grok_account_id WHERE a.id=studio_generation_jobs.owner AND a.active=true AND g.active=true AND a.session_version=studio_generation_jobs.session_version AND (a.role='admin' OR a.grok_account_id=studio_generation_jobs.grok_account_id OR g.label='语言模型写作主机'))";
const cleanup=async account=>{
await q("UPDATE studio_generation_jobs SET status='failed',error='执行超时或排队已过期，未自动重复调用',updated=$1 WHERE grok_account_id=$2 AND ((status='running' AND leased_until<=$1) OR (status='queued' AND created<$3))",now,account,now-900000);
await q("UPDATE studio_generation_jobs SET status='failed',error='账户权限或分配已变更',updated=$1 WHERE grok_account_id=$2 AND status IN ('queued','running') AND NOT "+validity,now,account);
};
if(workerAction){
if(req.method!=='POST')throw new AccountError(405,'请使用POST');const raw=bearer?.startsWith('Bearer ')?bearer.slice(7):'';
if(!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AccountError(401,'工作端连接无效，请重新下载连接配置');const tokenHash=hash(raw);
const worker=await one('SELECT w.grok_account_id,w.busy_until FROM studio_generation_workers w JOIN studio_grok_accounts g ON g.id=w.grok_account_id WHERE w.token_hash=$1 AND w.active=true AND g.active=true',tokenHash);
if(!worker)throw new AccountError(401,'工作端连接已失效或账户已停用');const account=worker.grok_account_id;
await cleanup(account);await q('UPDATE studio_generation_workers SET seen=$1 WHERE grok_account_id=$2 AND token_hash=$3 AND active=true',now,account,tokenHash);
if(action==='heartbeat')return json({connected:true});
const release=()=>q("UPDATE studio_generation_workers SET busy_until=0 WHERE grok_account_id=$1 AND token_hash=$2 AND NOT EXISTS(SELECT 1 FROM studio_generation_jobs WHERE grok_account_id=$1 AND status='running')",account,tokenHash);
if(action==='poll'){
const scriptHost=await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND label=$2',account,SCRIPT_HOST);
const until=now+(scriptHost?600000:120000);
const locked=await one('UPDATE studio_generation_workers SET busy_until=$1 WHERE grok_account_id=$2 AND token_hash=$3 AND active=true AND busy_until<=$4 RETURNING grok_account_id',until,account,tokenHash,now);
if(!locked)return json({job:null});
const lease=token();let claimed;
try{claimed=await one("UPDATE studio_generation_jobs SET status='running',lease_hash=$1,leased_until=$2,updated=$3 WHERE id=(SELECT id FROM studio_generation_jobs WHERE grok_account_id=$4 AND status='queued' ORDER BY created,id LIMIT 1) AND status='queued' AND "+validity+' RETURNING id,prompt',hash(lease),until,now,account)}catch(e){await release();throw e}
if(!claimed){await release();return json({job:null})}return json({job:{id:claimed.id,prompt:claimed.prompt,lease}});
}
const job=await one('SELECT * FROM studio_generation_jobs WHERE id=$1 AND grok_account_id=$2',String(body.id||''),account);
if(!job||job.lease_hash!==hash(String(body.lease||'')))throw new AccountError(409,'任务执行凭据无效');
if(job.status==='done'||job.status==='failed'){if(job.leased_until<=now)throw new AccountError(409,'任务执行已过期');return json({saved:true,status:job.status})}
if(job.status!=='running'||job.leased_until<=now)throw new AccountError(409,'任务执行已过期');
let result=null,error=null;if(body.error){if(!Object.hasOwn(ERRORS,body.error))throw new AccountError(400,'错误类型无效');error=ERRORS[body.error]}else{if(typeof body.result!=='string'||!body.result.trim())throw new AccountError(400,'文字结果不能为空');if(Buffer.byteLength(body.result)>65536)throw new AccountError(413,'文字结果上限64KB');result=body.result}
const saved=await one("UPDATE studio_generation_jobs SET status=$1,result=$2,error=$3,updated=$4 WHERE id=$5 AND grok_account_id=$6 AND status='running' AND lease_hash=$7 AND leased_until>$4 AND "+validity+' RETURNING id',error?'failed':'done',result,error,now,job.id,account,job.lease_hash);
if(!saved)throw new AccountError(409,'任务已失效');await release();return json({saved:true,status:error?'failed':'done'});
}
const raw=cookie(req),user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),now):null;
if(!user)throw new AccountError(401,'请先使用手机号登录');
if(action==='script-worker-config'){
requireAdmin(user);if(req.method!=='POST')throw new AccountError(405,'请使用POST');
await q('INSERT INTO studio_grok_accounts (id,label) VALUES ($1,$2) ON CONFLICT(label) DO NOTHING',randomUUID(),SCRIPT_HOST);
const account=await one('SELECT id,label FROM studio_grok_accounts WHERE label=$1 AND active=true',SCRIPT_HOST);
if(!account)throw new AccountError(409,'写作服务已停用，请先启用');
const credential=token();await q('INSERT INTO studio_generation_workers (grok_account_id,token_hash,created) VALUES ($1,$2,$3) ON CONFLICT(grok_account_id) DO UPDATE SET token_hash=excluded.token_hash,active=true,seen=0',account.id,hash(credential),now);
await q('INSERT INTO studio_account_audit (id,actor,action,target,created) VALUES ($1,$2,$3,$4,$5)',randomUUID(),user.id,'configure-script-worker',account.id,now);
return json({config:{format:'jbp-mac-script-worker-v1',origin:url.origin,accountId:account.id,workerToken:credential}},201);
}
if(action==='worker-config'||action==='worker-revoke'){
requireAdmin(user);if(req.method!=='POST')throw new AccountError(405,'请使用POST');const account=await one('SELECT id,label FROM studio_grok_accounts WHERE id=$1 AND active=true',String(body.grokAccountId||''));if(!account)throw new AccountError(400,'请选择启用的 Grok 账户');
if(action==='worker-revoke'){await q('UPDATE studio_generation_workers SET active=false,seen=0 WHERE grok_account_id=$1',account.id);return json({revoked:true})}
const credential=token();await q('INSERT INTO studio_generation_workers (grok_account_id,token_hash,created) VALUES ($1,$2,$3) ON CONFLICT(grok_account_id) DO UPDATE SET token_hash=excluded.token_hash,active=true,seen=0',account.id,hash(credential),now);
await q('INSERT INTO studio_account_audit (id,actor,action,target,created) VALUES ($1,$2,$3,$4,$5)',randomUUID(),user.id,'configure-mac-text-worker',account.id,now);
return json({config:{format:'jbp-mac-text-worker-v1',origin:url.origin,grokAccountId:account.id,grokLabel:account.label,workerToken:credential}},201);
}
if(action==='status'&&req.method==='GET'){
if(url.searchParams.get('channel')==='script'){const w=await one('SELECT w.seen FROM studio_generation_workers w JOIN studio_grok_accounts g ON g.id=w.grok_account_id WHERE g.label=$1 AND w.active=true AND g.active=true',SCRIPT_HOST);return json({online:!!w&&Number(w.seen)>now-45000})}
if(user.role==='admin'){const workers=await q('SELECT g.id,g.label,g.active,w.seen,w.active AS worker_active FROM studio_grok_accounts g LEFT JOIN studio_generation_workers w ON w.grok_account_id=g.id ORDER BY g.label');return json({workers:workers.map(w=>({id:w.id,label:w.label,active:!!w.active,configured:w.worker_active!==null&&!!w.worker_active,online:!!w.active&&!!w.worker_active&&Number(w.seen)>now-45000}))})}
const w=await one('SELECT w.seen FROM studio_generation_workers w JOIN studio_grok_accounts g ON g.id=w.grok_account_id WHERE w.grok_account_id=$1 AND w.active=true AND g.active=true',user.grok_account_id);return json({online:!!w&&Number(w.seen)>now-45000});
}
if(action==='submit'&&req.method==='POST'){
if(user.role!=='admin'&&Object.hasOwn(body,'grokAccountId'))throw new AccountError(400,'成员不能指定后台账户');
if(body.channel!==undefined&&body.channel!=='script')throw new AccountError(400,'生成通道无效');
const scriptAccount=body.channel==='script'?await one('SELECT id FROM studio_grok_accounts WHERE label=$1 AND active=true',SCRIPT_HOST):null;
const account=body.channel==='script'?scriptAccount?.id:user.role==='admin'?String(body.grokAccountId||''):user.grok_account_id;
if(!account||!await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND active=true',account))throw new AccountError(409,'请让管理员分配启用的生成账户');
if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>8000)throw new AccountError(400,'请输入1–8000字的文字要求');
if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId))throw new AccountError(400,'任务提交标识无效');
const duplicate=await one('SELECT * FROM studio_generation_jobs WHERE owner=$1 AND request_key=$2',user.id,body.requestId);if(duplicate){if(duplicate.admin_deleted)throw new AccountError(410,'此任务已移入回收站');return json({job:jobView(duplicate)})}
await cleanup(account);
const w=await one('SELECT seen FROM studio_generation_workers WHERE grok_account_id=$1 AND active=true',account);if(!w||Number(w.seen)<=now-45000)throw new AccountError(409,'模型服务尚未连接，请联系管理员');
const pending=await one("SELECT count(*) AS n FROM studio_generation_jobs WHERE owner=$1 AND status IN ('queued','running')",user.id);if(Number(pending.n)>=3)throw new AccountError(429,'你有3个待完成任务，请等待结果');
const total=await one("SELECT count(*) AS n FROM studio_generation_jobs WHERE grok_account_id=$1 AND status IN ('queued','running')",account);if(Number(total.n)>=50)throw new AccountError(429,'生成账户排队已满，请稍后再试');
const id=randomUUID();await q("INSERT INTO studio_generation_jobs (id,owner,grok_account_id,session_version,request_key,prompt,status,created,updated) VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$7) ON CONFLICT(owner,request_key) DO NOTHING",id,user.id,account,user.session_version,body.requestId,body.prompt.trim(),now);
const job=await one('SELECT * FROM studio_generation_jobs WHERE owner=$1 AND request_key=$2',user.id,body.requestId);return json({job:jobView(job)},201);
}
if((action==='job'||action==='jobs')&&req.method==='GET'){
const accounts=await q("SELECT DISTINCT grok_account_id FROM studio_generation_jobs WHERE owner=$1 AND status IN ('queued','running')",user.id);for(const a of accounts)await cleanup(a.grok_account_id);
if(action==='job'){const j=await one('SELECT * FROM studio_generation_jobs WHERE id=$1 AND owner=$2 AND admin_deleted=false',String(url.searchParams.get('id')||''),user.id);if(!j)throw new AccountError(404,'任务不存在');return json({job:jobView(j)})}
return json({jobs:(await q('SELECT * FROM studio_generation_jobs WHERE owner=$1 AND admin_deleted=false ORDER BY created DESC,id DESC LIMIT 10',user.id)).map(jobView)});
}
throw new AccountError(404,'生成接口不存在');
}catch(e){if(!e.status)console.error('generation-service',e.code||e.name);return json({error:e.status?e.message:'文字生成服务暂不可用'},e.status||503)}}}
