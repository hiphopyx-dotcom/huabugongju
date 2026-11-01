import {randomUUID as uuid} from 'node:crypto';
import {AccountError,hash,token,cookie,safeOrigin,requireAdmin} from './security.mjs';
import {validateImageData,IMAGE_LIMITS} from './images.mjs';

const LEASE_MS=600000,ONLINE_MS=45000;
/** Fixed member-browser failure reasons shown to the submitter; free text from the Mac is never stored. */
export const FAILURE_REASONS=Object.freeze({
 LOGIN:'Mac 上的 Grok 会员账号未登录或登录已过期，请在 Mac 上重新登录 grok.com 后再出图',
 CAPTCHA:'grok.com 要求人机验证，请在 Mac 上手动完成验证后再出图',
 QUOTA:'Grok 会员生图额度已用完，请等额度恢复后再出图',
 CONTENT:'提示词或图片被 Grok 拒绝生成，请修改提示词后重试',
 TIMEOUT:'Grok 页面超时未出图，未重复提交；请稍后重试',
 ACCOUNT:'Mac 上登录的 Grok 账号与配置不一致，已停止出图',
 BUSY:'Mac 上该 Grok 浏览器窗口正被占用，请关闭后再出图',
 SUBMIT:'Grok 页面提交失败，请重试',
 PAGE:'Grok 页面异常，未能完成出图，请重试；多次失败请联系管理员',
 UNSUPPORTED:'暂不支持视频任务，未开始生成',
 REF_LIMIT:'参考图数量超过网页当前允许的张数，本次未提交，请减少后重试',
});
export const STRUCTURE_STEPS=Object.freeze(['打开页面','切图片','选宽高比','找输入框','输入','上传参考图','改图','提交','等图','下载']);
export function structureMessage(step){return STRUCTURE_STEPS.includes(step)?`网页结构变化：${step}`:'';}
const ACCOUNT_LABEL=/^[\p{L}\p{N}_-]{1,32}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL=/^[A-Za-z0-9_-]{43}$/;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new AccountError(400,'请求字段无效');}
function publicOrigin(value){try{const url=new URL(value);if(url.protocol==='https:'&&url.origin===value)return value;}catch{}throw new AccountError(503,'工作端地址尚未配置');}
async function body(req){
 if(Number(req.headers.get('content-length'))>IMAGE_LIMITS.requestBytes)throw new AccountError(413,'请求过大');
 const reader=req.body?.getReader();if(!reader)return {};
 const parts=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>IMAGE_LIMITS.requestBytes){await reader.cancel();throw new AccountError(413,'请求过大');}parts.push(Buffer.from(value));}}finally{reader.releaseLock();}
 try{const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));fields(parsed,['id','lease','dataUrl','error','reason','accountLabel','workerId','step']);return parsed;}catch(error){if(error.status)throw error;throw new AccountError(400,'请求格式错误');}
}

function referenceDownload(origin,id,part){const url=new URL('/api/image-worker',origin);url.searchParams.set('action','reference');url.searchParams.set('id',id);url.searchParams.set('part',part);return url.href;}
function presentJob(row,lease,origin){
 const payload=row.payload||{},data=payload.data||{},references=Array.isArray(payload.references)?payload.references:[];
 const task=payload.task&&typeof payload.task==='object'?payload.task:{};
 const type=task.type==='edit'||task.type==='video'?task.type:'image';
 const base={id:row.id,lease,prompt:data.prompt,ratio:data.ratio,resolution:data.resolution,references};
 if(type==='image')return base;
 if(type==='edit'){
  const index=Number.isInteger(task.sourceIndex)&&task.sourceIndex>=0&&task.sourceIndex<references.length?task.sourceIndex:(references.length?0:-1);
  return {...base,type:'edit',source:index>=0?{url:referenceDownload(origin,row.id,'source')}:undefined,references:references.filter((_,i)=>i!==index)};
 }
 return {...base,type:'video',ratio:task.ratio||data.ratio,resolution:task.resolution||data.resolution,duration:task.duration,audio:task.audio,references};
}
function referencePart(payload,part){
 const references=Array.isArray(payload?.references)?payload.references:[];
 const task=payload?.task&&typeof payload.task==='object'?payload.task:{};
 const index=part==='source'?(Number.isInteger(task.sourceIndex)&&task.sourceIndex>=0?task.sourceIndex:0):Number(part);
 if(!Number.isInteger(index)||index<0||index>=references.length)throw new AccountError(404,'参考图不存在');
 return validateImageData(references[index]);
}
function accountNote(input,workerId){
 const extra={};
 if(Object.hasOwn(input,'accountLabel')){if(typeof input.accountLabel!=='string'||!ACCOUNT_LABEL.test(input.accountLabel))throw new AccountError(400,'账号标签无效');extra.accountLabel=input.accountLabel;}
 if(Object.hasOwn(input,'workerId')){if(input.workerId!==workerId)throw new AccountError(400,'工作端标识无效');extra.workerId=workerId;}
 return extra;
}
function reasonText(input){
 if(!Object.hasOwn(input,'reason')){if(Object.hasOwn(input,'step'))throw new AccountError(400,'失败原因无效');return '';}
 if(input.reason==='STRUCTURE'){const text=structureMessage(input.step);if(!text)throw new AccountError(400,'失败原因无效');return text;}
 if(Object.hasOwn(input,'step')||!Object.hasOwn(FAILURE_REASONS,input.reason))throw new AccountError(400,'失败原因无效');
 return FAILURE_REASONS[input.reason];
}

/** All owner/project/reference metadata stays on this server. */
export function createImageWorkerService(query,config={}){
 const q=(sql,...args)=>query(sql,args),one=async(sql,...args)=>(await q(sql,...args))[0];
 const now=()=>config.now?.()??Date.now(),id=()=>config.randomUUID?.()??uuid();
 return {
  async status(){const row=await one("SELECT active,seen FROM studio_image_workers WHERE id='primary'");return {configured:!!row?.active,online:!!row?.active&&Number(row.seen)>0&&Number(row.seen)>now()-ONLINE_MS};},
  async submit({user,sessionHash,data,inputHash,amount,references=[],referenceIds=[],sourceIndex=-1,origin}){
   origin=publicOrigin(origin);
   if(config.publicOrigin&&origin!==publicOrigin(config.publicOrigin))throw new AccountError(403,'请在当前网站内操作');
   const current=now(),job={...data,references:undefined,id:id(),inputHash};
   const parent=data.metadata?.parentImageId||'';
   let index=Number.isInteger(sourceIndex)?sourceIndex:-1;
   if(parent&&(index<0||index>=references.length)){const found=referenceIds.indexOf(parent);if(found>=0&&found<references.length)index=found;}
   const task=parent?{type:'edit',sourceIndex:index}:{type:'image'};
   const payload={data:job,references,referenceIds:[...new Set([...referenceIds,...(parent?[parent]:[])])],origin,task};
   return (await one('SELECT studio_image_worker_begin($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7) AS result',
    user.id,sessionHash,user.session_version,JSON.stringify(job),amount,JSON.stringify(payload),current)).result;
  },
  async cleanup(owner){await q('SELECT studio_image_worker_cleanup($1,$2)',owner,now());},
  async decorate(job){if(!job)return job;const row=await one('SELECT d.state FROM studio_image_dispatch d JOIN studio_image_jobs j ON j.id=d.job_id WHERE j.id=$1 AND j.owner=$2',job.id,job.owner);return {...job,dispatch_state:row?.state??null};},
 };
}

export function createImageWorkerHandler(query,config={}){
 const q=(sql,...args)=>query(sql,args),one=async(sql,...args)=>(await q(sql,...args))[0];
 const now=()=>config.now?.()??Date.now(),service=createImageWorkerService(query,config);
 return async req=>{try{
  const url=new URL(req.url),action=url.searchParams.get('action')||'status',current=now(),origin=publicOrigin(config.publicOrigin);
  if(url.origin!==origin)throw new AccountError(403,'请在当前网站内操作');
  const params=[...url.searchParams.keys()];
  if(action==='reference'){if(params.some(key=>!['action','id','part'].includes(key)))throw new AccountError(400,'请求字段无效');}
  else if(params.some(key=>key!=='action'))throw new AccountError(400,'请求字段无效');
  const workerAction=['heartbeat','poll','complete','reference'].includes(action);
  if(workerAction){
   if(action==='reference'?req.method!=='GET':req.method!=='POST')throw new AccountError(405,action==='reference'?'请使用 GET':'请使用 POST');
   if(req.headers.has('origin')||[...req.headers.keys()].some(key=>key.startsWith('sec-fetch-')))throw new AccountError(403,'工作端请求无效');
   const raw=req.headers.get('authorization')||'',credential=raw.startsWith('Bearer ')?raw.slice(7):'';
   if(!CREDENTIAL.test(credential))throw new AccountError(401,'工作端连接无效，请重新下载配置');
   const tokenHash=hash(credential),worker=await one("SELECT id FROM studio_image_workers WHERE id='primary' AND token_hash=$1 AND active=true",tokenHash);
   if(!worker)throw new AccountError(401,'工作端连接已失效');
   if(action==='reference'){
    const id=url.searchParams.get('id')||'',part=url.searchParams.get('part')||'',lease=req.headers.get('x-jbp-lease')||'';
    if(!UUID.test(id)||!CREDENTIAL.test(lease)||!/^(source|[0-2])$/.test(part))throw new AccountError(400,'任务凭据格式无效');
    const context=await one("SELECT d.payload FROM studio_image_dispatch d JOIN studio_image_jobs j ON j.id=d.job_id JOIN studio_image_workers w ON w.id=d.worker_id WHERE j.id=$1 AND d.lease_hash=$2 AND d.lease_until>$3 AND d.state='leased' AND w.id='primary' AND w.token_hash=$4 AND w.active=true AND d.payload->>'origin'=$5",id,hash(lease),current,tokenHash,origin);
    if(!context)throw new AccountError(409,'任务执行凭据已失效');
    const file=referencePart(context.payload,part);
    return new Response(file.buffer,{status:200,headers:{'Content-Type':file.mime,'Content-Length':String(file.bytes),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
   }
   const input=await body(req);
   if(action==='heartbeat'){fields(input,[]);await q('SELECT studio_image_worker_heartbeat($1,$2)',tokenHash,current);return json({connected:true});}
   if(action==='poll'){
    fields(input,[]);const lease=token(),row=await one('SELECT studio_image_worker_poll($1,$2,$3,$4,$5) AS job',tokenHash,hash(lease),current,current+LEASE_MS,origin),job=row.job;
    return json({job:job?presentJob(job,lease,origin):null});
   }
   const completeKeys=['id','lease','accountLabel','workerId',...(Object.hasOwn(input,'error')?['error','reason']:['dataUrl']),...(Object.hasOwn(input,'step')?['step']:[])];
   fields(input,completeKeys);
   const noted=accountNote(input,worker.id),shown=reasonText(input);
   if(typeof input.id!=='string'||!UUID.test(input.id)||typeof input.lease!=='string'||!CREDENTIAL.test(input.lease))throw new AccountError(400,'任务凭据格式无效');
   if(Object.hasOwn(input,'error')&&!['REJECTED','UNCERTAIN'].includes(input.error))throw new AccountError(400,'结果状态无效');
   const context=await one("SELECT j.id,j.input_hash,d.payload FROM studio_image_dispatch d JOIN studio_image_jobs j ON j.id=d.job_id JOIN studio_image_workers w ON w.id=d.worker_id WHERE j.id=$1 AND d.lease_hash=$2 AND d.lease_until>$3 AND w.id='primary' AND w.token_hash=$4 AND w.active=true AND d.payload->>'origin'=$5",input.id,hash(input.lease),current,tokenHash,origin);
   if(!context)throw new AccountError(409,'任务执行凭据已失效');
   let saved=null;
   if(!Object.hasOwn(input,'error')){
    const file=validateImageData(input.dataUrl),payload=context.payload;
    saved={...payload.data,...file,buffer:undefined,references:undefined,referenceIds:payload.referenceIds,id:context.id,
     inputHash:context.input_hash,source:'generated',contentUrl:payload.origin+`/api/images?action=content&id=${context.id}`};
    if(Object.keys(noted).length)saved.metadata={...(saved.metadata||{}),...noted};
   }
   if(Object.keys(noted).length)await q('UPDATE studio_image_jobs SET metadata = COALESCE(metadata, \'{}\'::jsonb) || $2::jsonb WHERE id=$1',input.id,JSON.stringify(noted));
   const resultHash=hash(JSON.stringify(Object.hasOwn(input,'error')?{error:input.error}:{dataUrl:input.dataUrl}));
   const result=await one('SELECT studio_image_worker_complete($1,$2,$3,$4,$5::jsonb,$6,$7) AS job',
    tokenHash,input.id,hash(input.lease),resultHash,saved?JSON.stringify(saved):null,input.error??null,current);
   if(shown&&['failed','uncertain'].includes(result.job.status))await q('UPDATE studio_image_jobs SET error=$2 WHERE id=$1 AND status IN (\'failed\',\'uncertain\')',input.id,shown);
   return json({saved:true,status:result.job.status});
  }
  safeOrigin(req);
  const raw=cookie(req),user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),current):null;
  requireAdmin(user);
  if(action==='status'&&req.method==='GET')return json(await service.status());
  if(['config','revoke'].includes(action)&&req.method==='POST'){
   fields(await body(req),[]);
   const credential=action==='config'?token():'';
   await q('SELECT studio_image_worker_configure($1,$2,$3)',credential?hash(credential):'',action==='config',current);
   return action==='revoke'?json({revoked:true}):json({config:{format:'jbp-mac-image-worker-v1',origin,workerId:'primary',workerToken:credential}},201);
  }
  throw new AccountError(404,'工作端接口不存在');
 }catch(error){
  const message=String(error.message||'');
  if(message.includes('IMAGE_WORKER_AUTH'))return json({error:'工作端连接已失效'},401);
  if(message.includes('IMAGE_WORKER_LEASE')||message.includes('IMAGE_WORKER_RESULT_CONFLICT'))return json({error:'任务执行凭据或结果已失效'},409);
  return json({error:error.status?error.message:'图片工作端暂不可用'},error.status||503);
 }};
}
