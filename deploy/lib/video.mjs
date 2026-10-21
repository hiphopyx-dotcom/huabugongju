import {randomUUID,createHash} from 'node:crypto';
import {AccountError,hash,cookie,safeOrigin} from './security.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const base='https://generativelanguage.googleapis.com/v1beta/';
const idOk=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const digest=s=>createHash('sha256').update(s).digest('hex');
const terminal=new Set(['succeeded','failed','uncertain','cancelled']);
const active=new Set(['submitting','queued','polling','running']);
const statuses=new Set([...terminal,...active]);
const models=new Set(['veo-3.1-generate-preview','veo-3.1-fast-generate-preview']);
const errorText=e=>String(e?.message||e||'服务错误').slice(0,240);
function view(r){
  return {id:r.id,projectId:r.project_id,shotId:r.shot_id,shotLabel:r.shot_label,prompt:r.prompt,
    inputHash:r.input_hash,referenceIds:JSON.parse(r.reference_ids||'[]'),
    duration:Number(r.duration),ratio:r.ratio,model:r.model,status:r.status,
    downloadable:r.status==='succeeded'&&!!r.output_uri,
    error:r.error_text||'',created:Number(r.created),updated:Number(r.updated)};
}
function img(raw){
  if(raw===undefined||raw===null||raw==='')return null;
  if(typeof raw!=='string')throw new AccountError(400,'参考图片格式错误');
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if(!match||match[2].length>1000000)throw new AccountError(413,'单张参考图必须是小于约750KB的PNG/JPEG/WebP，请压缩后再试');
  return {inlineData:{mimeType:'image/'+match[1],data:match[2]}};
}
export function buildVeoRequest(input){
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>3200)throw new AccountError(400,'视频提示词应在1至3200字之间');
  if(!['16:9','9:16'].includes(input.ratio))throw new AccountError(400,'Veo仅支持16:9或9:16');
  if(!models.has(input.model))throw new AccountError(400,'视频模型不支持');
  if(!['text','start','interpolate','references'].includes(input.mode))throw new AccountError(400,'视频生成模式无效');
  const first=img(input.first),last=img(input.last);
  const refs=Array.isArray(input.refs)?input.refs.map(img):[];
  if(refs.length>3||refs.some(x=>!x))throw new AccountError(400,'角色参考图最多三张');
  if(input.mode==='start'&&!first)throw new AccountError(400,'图生视频必须有首帧');
  if(input.mode==='interpolate'&&(!first||!last))throw new AccountError(400,'首尾帧生成必须同时提供有效的两张图');
  if(input.mode==='references'&&!refs.length)throw new AccountError(400,'多参考图生成需要至少一张角色或场景图');
  if(input.mode==='text'&&(first||last||refs.length))throw new AccountError(400,'文生视频不能携带参考图');
  if(input.mode==='start'&&(last||refs.length)||input.mode==='interpolate'&&refs.length||input.mode==='references'&&(first||last))
    throw new AccountError(400,'一次请求请只选择一种参考图模式');
  const instance={prompt:input.prompt.trim()};
  if(input.mode==='start'||input.mode==='interpolate')instance.image=first;
  if(input.mode==='interpolate')instance.lastFrame=last;
  if(input.mode==='references')instance.referenceImages=refs.map(image=>({image,referenceType:'asset'}));
  // Veo 3.1 reference-image jobs must be 8s, and each submission is one billable video.
  return {instances:[instance],parameters:{aspectRatio:input.ratio,durationSeconds:'8',resolution:'720p',numberOfVideos:1,personGeneration:input.mode==='text'?'allow_all':'allow_adult'}};
}
const operationName=v=>typeof v==='string'&&/^(?:models\/[A-Za-z0-9._-]+\/)?operations\/[A-Za-z0-9_./:-]{1,220}$/.test(v);
const videoHost=uri=>{
  let u;try{u=new URL(uri)}catch{throw new Error('上游视频下载地址无效')}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||!['generativelanguage.googleapis.com','storage.googleapis.com'].includes(u.hostname))
    throw new Error('上游视频地址不在允许的Google文件域名内');
  return u;
};
async function upstream(fetcher,path,key,{method='GET',body}={}){
  const response=await fetcher(base+path,{method,headers:{'x-goog-api-key':key,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(24000)});
  if(!response.ok)throw new Error('Veo接口HTTP '+response.status+'：请检查模型权限、额度或地区限制');
  const payload=await response.json();
  if(payload?.error)throw new Error('Veo报告错误：'+String(payload.error.message||'请检查额度').slice(0,120));
  return payload;
}
function parseOperation(payload){
  if(!payload||!operationName(payload.name))throw new Error('Veo未返回有效异步任务ID，可能已受理，请勿重复付费提交');
  return payload.name;
}
async function readBody(req){
  const size=Number(req.headers.get('content-length')||0);
  if(size>3500000)throw new AccountError(413,'参考图片过大，压缩后提交');
  const raw=await req.text();if(Buffer.byteLength(raw)>3500000)throw new AccountError(413,'参考图片过大，压缩后提交');
  let obj;try{obj=JSON.parse(raw)}catch{throw new AccountError(400,'JSON格式错误')}
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new AccountError(400,'请求格式错误');
  return obj;
}
export function createVideoHandler(query,config={}){
 return async req=>{
  try{
   const url=new URL(req.url),action=url.searchParams.get('action')||'jobs',now=config.now?.()??Date.now();
   safeOrigin(req);
   const q=(sql,...params)=>query(sql,params),one=async(sql,...params)=>(await q(sql,...params))[0];
   const token=cookie(req);
   const user=token?await one('SELECT a.id,a.role FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',
     hash(token),now):null;
   if(!user)throw new AccountError(401,'请先登录剧爆棚账户');
   const key=config.apiKey??process.env.GEMINI_API_KEY;
   const configured=!!key;
   const fetcher=config.fetch||fetch;
   if(req.method==='GET'&&action==='jobs'){
     const projectId=url.searchParams.get('projectId');
     if(!idOk(projectId))throw new AccountError(400,'项目ID无效');
     const jobs=await q('SELECT * FROM studio_video_jobs WHERE owner=$1 AND project_id=$2 ORDER BY created DESC LIMIT 40',user.id,projectId);
     return json({jobs:jobs.map(view),configured});
   }
   if(req.method==='GET'&&action==='download'){
     const id=url.searchParams.get('id');
     if(!idOk(id))throw new AccountError(400,'任务ID无效');
     const job=await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id);
     if(!job)throw new AccountError(404,'视频任务不存在');
     if(job.status!=='succeeded'||!job.output_uri)throw new AccountError(409,'视频尚未生成成功');
     // Never accept a client URL; source URL is from the verified provider operation.
     let uri=videoHost(job.output_uri);
     const headers={'x-goog-api-key':key};
     let response=await fetcher(uri,{headers,redirect:'manual',signal:AbortSignal.timeout(24000)});
     // Follow at most one allowlisted Google-host redirect while retaining the API key ONLY for first-party video host.
     if([301,302,303,307,308].includes(response.status)){
       uri=videoHost(new URL(response.headers.get('location')||'',uri).toString());
       response=await fetcher(uri,{headers:uri.hostname==='generativelanguage.googleapis.com'?headers:{},redirect:'manual',signal:AbortSignal.timeout(24000)});
     }
     if(!response.ok||!response.body)throw new AccountError(502,'上游视频下载失败或已过期（请及时下载成片）');
     const type=response.headers.get('content-type')||'';
     if(!/video\/|application\/octet-stream/i.test(type))throw new AccountError(502,'上游未返回视频数据');
     const contentLength=Number(response.headers.get('content-length')||0);
     if(contentLength>65000000)throw new AccountError(413,'视频超过65MB，请使用官方平台下载');
     return new Response(response.body,{headers:{'Content-Type':'video/mp4','Cache-Control':'private,no-store',
       'Content-Disposition':'attachment; filename="jbp-veo-'+job.id+'.mp4"','X-Content-Type-Options':'nosniff'}});
   }
   if(req.method!=='POST')throw new AccountError(405,'视频接口操作需要POST');
   const body=await readBody(req);
   if(action==='start'){
     if(!configured)throw new AccountError(503,'请管理员在服务端配置GEMINI_API_KEY，尚未接通Veo视频模型');
     if(!idOk(body.projectId)||!idOk(body.requestId)||typeof body.shotId!=='string'||body.shotId.length>128)
       throw new AccountError(400,'项目或镜头标识无效');
     if(typeof body.shotLabel!=='string'||body.shotLabel.length>100)throw new AccountError(400,'镜头标题过长');
     if(!Array.isArray(body.referenceIds)||body.referenceIds.length>6||body.referenceIds.some(x=>!idOk(x)))
       throw new AccountError(400,'参考素材ID无效');
     const payload=buildVeoRequest(body);
     const inputHash=digest(JSON.stringify({payload,projectId:body.projectId,shotId:body.shotId,referenceIds:body.referenceIds}));
     const duplicate=await one('SELECT * FROM studio_video_jobs WHERE owner=$1 AND request_key=$2',user.id,body.requestId);
     if(duplicate){if(duplicate.input_hash!==inputHash)throw new AccountError(409,'提交标识被不同请求重复使用');return json({job:view(duplicate),duplicate:true})}
     const daily=await one('SELECT count(*) AS n FROM studio_video_jobs WHERE owner=$1 AND created>$2',user.id,now-86400000);
     if(Number(daily?.n||0)>=Number(config.dailyLimit||6))throw new AccountError(429,'今天的视频生成次数已达上限，请勿连续误提交');
     const inFlight=await one("SELECT count(*) AS n FROM studio_video_jobs WHERE owner=$1 AND status IN ('submitting','queued','polling','running')",user.id);
     if(Number(inFlight?.n||0)>=3)throw new AccountError(429,'同时运行的视频最多3条；请刷新已完成任务再继续');
     const id=randomUUID(),model=body.model,ratio=body.ratio;
     const inserted=await one("INSERT INTO studio_video_jobs(id,owner,project_id,request_key,shot_id,shot_label,prompt,input_hash,reference_ids,duration,ratio,model,status,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,8,$10,$11,'submitting',$12,$12) ON CONFLICT(owner,request_key) DO NOTHING RETURNING id",
       id,user.id,body.projectId,body.requestId,body.shotId,body.shotLabel,body.prompt,inputHash,JSON.stringify(body.referenceIds),ratio,model,now);
     if(!inserted){const race=await one('SELECT * FROM studio_video_jobs WHERE owner=$1 AND request_key=$2',user.id,body.requestId);if(race?.input_hash!==inputHash)throw new AccountError(409,'并发提交冲突');return json({job:view(race),duplicate:true})}
     try{
       const operation=parseOperation(await upstream(fetcher,'models/'+model+':predictLongRunning',key,{method:'POST',body:payload}));
       await q("UPDATE studio_video_jobs SET operation_name=$1,status='queued',updated=$2 WHERE id=$3 AND owner=$4 AND status='submitting'",
         operation,now,id,user.id);
       return json({job:view(await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id))},201);
     }catch(e){
       // A network timeout can happen after Google accepted a billable job; never silently retry.
       await q("UPDATE studio_video_jobs SET status='uncertain',error_text=$1,updated=$2 WHERE id=$3 AND owner=$4 AND status='submitting'",
         errorText(e),now,id,user.id);
       return json({error:'提交结果无法确认，可能已产生费用；请勿立即重新提交。'+errorText(e)},502);
     }
   }
   const id=body.id;if(!idOk(id))throw new AccountError(400,'任务ID无效');
   const job=await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id);
   if(!job)throw new AccountError(404,'只能管理自己的视频任务');
   if(action==='cancel'){
     if(job.status==='succeeded')throw new AccountError(409,'已完成的视频不能通过此操作取消');
     if(job.status==='submitting'||job.status==='polling')throw new AccountError(409,'正在提交或刷新，稍后再试');
     if(terminal.has(job.status))return json({job:view(job)});
     await q("UPDATE studio_video_jobs SET status='cancelled',updated=$1 WHERE id=$2 AND owner=$3 AND status IN ('queued','running')",now,id,user.id);
     return json({job:view(await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id)),note:'已停止工作台跟踪；Google侧任务可能继续运行和计费。'});
   }
   if(action==='poll'){
     if(terminal.has(job.status)||job.status==='submitting')return json({job:view(job)});
     if(job.status==='polling'||now-Number(job.updated)<5000)return json({job:view(job),note:'刷新间隔至少5秒'});
     const locked=await one("UPDATE studio_video_jobs SET status='polling',updated=$1 WHERE id=$2 AND owner=$3 AND status IN ('queued','running') AND updated<=$4 RETURNING id",
       now,id,user.id,now-5000);
     if(!locked)return json({job:view(await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id))});
     try{
       if(!operationName(job.operation_name))throw new Error('上游异步任务标识丢失，暂停刷新');
       const result=await upstream(fetcher,job.operation_name,key);
       let status='running',videoUri='',error='';
       if(result.done){
         if(result.error){status='failed';error=errorText(result.error.message||'模型生成失败')}
         else{
           const candidate=result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
           if(candidate){videoUri=videoHost(candidate).toString();status='succeeded'}
           else {status='failed';error='模型已完成但没有可用MP4，可能被安全过滤';}
         }
       }
       await q("UPDATE studio_video_jobs SET status=$1,output_uri=$2,error_text=$3,updated=$4 WHERE id=$5 AND owner=$6 AND status='polling'",
         status,videoUri,error,now,id,user.id);
     }catch(e){
       await q("UPDATE studio_video_jobs SET status='running',error_text=$1,updated=$2 WHERE id=$3 AND owner=$4 AND status='polling'",errorText(e),now,id,user.id);
       return json({job:view(await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id)),note:'查询失败，可稍后再试；不会重新提交计费生成。'});
     }
     return json({job:view(await one('SELECT * FROM studio_video_jobs WHERE id=$1 AND owner=$2',id,user.id))});
   }
   throw new AccountError(404,'未知视频任务操作');
  }catch(e){
   if(!e?.status)console.error('video-generation',e?.code||e?.name||'unknown');
   return json({error:e?.status?e.message:'视频生成服务暂不可用'},e?.status||503);
  }
 };
}
