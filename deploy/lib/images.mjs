import {randomUUID as uuid} from 'node:crypto';
import {AccountError,cookie,hash,safeOrigin} from './security.mjs';
import {createQuotaService} from './quota.mjs';

export const IMAGE_LIMITS=Object.freeze({imageBytes:3*1024*1024,referenceBytes:768*1024,referenceLimit:3,requestBytes:4*1024*1024+65536,maxPixels:40000000});
const KINDS=['角色','场景','道具','分镜'],RATIOS=['9:16','16:9','1:1','4:3','3:4'],RESOLUTIONS=['1k','2k'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>Response.json(value,{status,headers:NO_STORE});
const fail=(message='请求格式错误',status=400)=>{throw new AccountError(status,message)};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>{if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('请求字段无效');return value};
function text(value,fallback,max){if(value===undefined)return fallback;if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('文字内容格式无效');return value.trim()||fallback}
function base(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(u.hostname))return '';return u.href.replace(/\/+$/,'')}catch{return ''}}
/** Environment routing stays server-side. A generic key requires its explicit base. */
export function imageServerConfig(env={}){
 const dedicated=typeof env.XAI_API_KEY==='string'?env.XAI_API_KEY.trim():'';
 if(dedicated)return {key:dedicated,baseUrl:'https://api.x.ai/v1',model:env.XAI_IMAGE_MODEL||env.AI_IMAGE_MODEL||'grok-imagine-image-2.0'};
 const generic=typeof env.AI_API_KEY==='string'?env.AI_API_KEY.trim():'';
 return {key:generic&&base(env.AI_BASE_URL)?generic:'',baseUrl:base(env.AI_BASE_URL),model:env.AI_IMAGE_MODEL||'grok-imagine-image-2.0'};
}
function dimensions(b,mime){
 if(mime==='image/png'){
  if(b.length<45||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.readUInt32BE(8)!==13||b.toString('ascii',12,16)!=='IHDR'||b.toString('ascii',b.length-8,b.length-4)!=='IEND')fail('PNG 图片内容无效');
  return [b.readUInt32BE(16),b.readUInt32BE(20)];
 }
 if(mime==='image/jpeg'){
  if(b.length<12||b[0]!==255||b[1]!==216||b.at(-2)!==255||b.at(-1)!==217)fail('JPEG 图片内容无效');
  let pos=2;
  while(pos<b.length-2){if(b[pos++]!==255)fail('JPEG 图片内容无效');while(b[pos]===255)pos++;const marker=b[pos++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(pos+2>b.length)break;const len=b.readUInt16BE(pos);if(len<2||pos+len>b.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(len<8)break;return [b.readUInt16BE(pos+5),b.readUInt16BE(pos+3)]}pos+=len}
  fail('JPEG 图片尺寸无效');
 }
 if(mime==='image/webp'){
  if(b.length<30||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length)fail('WebP 图片内容无效');
  const format=b.toString('ascii',12,16);
  if(format==='VP8X')return [1+b.readUIntLE(24,3),1+b.readUIntLE(27,3)];
  if(format==='VP8L'&&b[20]===47){const n=b.readUInt32LE(21);return [(n&0x3fff)+1,((n>>>14)&0x3fff)+1]}
  if(format==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a)return [b.readUInt16LE(26)&0x3fff,b.readUInt16LE(28)&0x3fff];
  fail('WebP 图片尺寸无效');
 }
 fail('只支持 PNG、JPEG 或 WebP 图片');
}
/** Strict data URLs only; no URL fetching or SVG parsing occurs. */
export function validateImageData(value,maxBytes=IMAGE_LIMITS.imageBytes){
 if(typeof value!=='string'||value.length>Math.ceil(maxBytes/3)*4+64)fail('图片超过大小限制',413);
 const m=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!m||m[2].length%4!==0)fail('请上传 PNG、JPEG 或 WebP 图片');
 const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>maxBytes)fail('图片超过大小限制',413);if(bytes.toString('base64')!==m[2])fail('图片编码无效');
 const [width,height]=dimensions(bytes,m[1]);if(width<1||height<1||width>16384||height>16384||width*height>IMAGE_LIMITS.maxPixels)fail('图片尺寸超过限制');
 return {dataUrl:value,mime:m[1],width,height,bytes:bytes.length,buffer:bytes,contentHash:hash(value)};
}
async function boundedText(source,limit){
 if(Number(source.headers?.get('content-length'))>limit)fail('请求过大',413);
 if(!source.body)return '';
 const reader=source.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('请求过大',413)}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
 return Buffer.concat(chunks).toString('utf8');
}
function sniffData(b64){
 if(typeof b64!=='string'||b64.length>Math.ceil(IMAGE_LIMITS.imageBytes/3)*4)throw new Error('invalid-result');
 const b=Buffer.from(b64.slice(0,64),'base64');const mime=b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'image/png':b[0]===255&&b[1]===216?'image/jpeg':b.toString('ascii',0,4)==='RIFF'?'image/webp':'';
 if(!mime)throw new Error('invalid-result');return `data:${mime};base64,${b64}`;
}
async function remoteGenerate(config,input){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),110000);
 try{
  const refs=input.references,payload={model:config.model,prompt:input.prompt,n:1,aspect_ratio:input.ratio,resolution:input.resolution,response_format:'b64_json'};
  if(refs.length===1)payload.image={type:'image_url',url:refs[0]};else if(refs.length)payload.images=refs.map(url=>({type:'image_url',url}));
  const response=await (config.fetcher||fetch)(config.baseUrl+(refs.length?'/images/edits':'/images/generations'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify(payload),signal:controller.signal,redirect:'error'});
  // A definite HTTP rejection did not produce a usable image. Ambiguous transport,
  // server failures and malformed success responses retain the reservation.
  if(!response.ok){await response.body?.cancel();throw Object.assign(new Error('request-rejected'),{definite:response.status>=400&&response.status<500&&response.status!==408})}
  const result=JSON.parse(await boundedText(response,Math.ceil(IMAGE_LIMITS.imageBytes/3)*4+100000));
  if(!Array.isArray(result.data)||result.data.length!==1||!result.data[0]?.b64_json)throw new Error('invalid-result');
  return {dataUrl:sniffData(result.data[0].b64_json)};
 }finally{clearTimeout(timer)}
}
function dto(i){return {id:i.id,projectId:i.project_id,name:i.name,kind:i.asset_kind,ratio:i.ratio,resolution:i.resolution,width:Number(i.width),height:Number(i.height),prompt:i.prompt,created:Number(i.created),contentUrl:`/api/images?action=content&id=${encodeURIComponent(i.id)}`,adminLocked:!!i.admin_locked,source:i.source}}
function jobDto(j){
 const reviewed=j.quota_state==='charged'||j.quota_state==='released',needsReview=j.status==='running'||(j.status==='uncertain'&&!reviewed);
 return {id:j.id,requestId:j.request_key,status:j.status,needsReview,error:j.status==='uncertain'&&reviewed?'管理员已核对额度，生成结果仍待确认':j.error||'',created:Number(j.created),...(j.item_id?{itemId:j.item_id}:{})};
}
function payload(body,action){
 const common=['requestId','projectId','projectTitle','name','kind','prompt'];
 keys(body,[...common,...(action==='generate'?['ratio','resolution','references']:['dataUrl','sourceId','sourceProjectTitle'])]);
 if(typeof body.requestId!=='string'||!UUID.test(body.requestId))fail('任务标识无效');
 if(!KINDS.includes(body.kind))fail('请选择角色、场景、道具或分镜');
 const data={requestId:body.requestId.toLowerCase(),projectId:text(body.projectId,'image-library',160),projectTitle:text(body.projectTitle,'图片库',160),name:text(body.name,body.kind+'图片',120),kind:body.kind,prompt:text(body.prompt,'',8000)};
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(data.projectId))fail('项目标识无效');
 if(action==='generate'){
  if(!data.prompt)fail('请输入图片提示词');data.ratio=body.ratio??'9:16';data.resolution=typeof body.resolution==='string'?body.resolution.toLowerCase():'1k';
  if(!RATIOS.includes(data.ratio)||!RESOLUTIONS.includes(data.resolution))fail('图片比例或清晰度无效');
  data.references=body.references??[];if(!Array.isArray(data.references)||data.references.length>IMAGE_LIMITS.referenceLimit)fail('最多使用3张参考图');
 }else{data.sourceId=text(body.sourceId,'',240);data.sourceProjectTitle=text(body.sourceProjectTitle,'',160)}
 return data;
}
const IMAGE_JOIN=' FROM studio_images i JOIN studio_asset_records a ON a.owner=i.owner AND a.project_id=i.project_id AND a.asset_id=i.id';
const ACTIVE_IMAGE='SELECT i.id,i.owner,i.project_id,i.name,i.asset_kind,i.ratio,i.resolution,i.width,i.height,i.prompt,i.created,i.source,a.admin_locked,a.admin_deleted'+IMAGE_JOIN;
const IMAGE_DATA='SELECT i.*,a.admin_locked,a.admin_deleted'+IMAGE_JOIN;
export function createImageHandler(query,config={}){
 const q=(sql,...args)=>query(sql,args),one=async(sql,...args)=>(await q(sql,...args))[0],quota=config.quota||createQuotaService(query);
 const provider={...config,key:typeof config.key==='string'?config.key.trim():'',baseUrl:base(config.baseUrl||'https://api.x.ai/v1'),model:typeof config.model==='string'&&config.model?config.model:'grok-imagine-image-2.0'};
 const configured=!!provider.key&&!!provider.baseUrl;
 const now=()=>config.now?.()??Date.now(),id=()=>config.randomUUID?.()??uuid();
 const image=async(owner,imageId,withData=false)=>one((withData?IMAGE_DATA:ACTIVE_IMAGE)+' WHERE i.owner=$1 AND i.id=$2 AND a.admin_deleted=false',owner,imageId);
 const jobs=async(owner)=>{
  await q("UPDATE studio_image_jobs SET status='uncertain',error='生成结果待核对，未重复调用；请联系管理员核对任务与额度',updated=$2 WHERE owner=$1 AND status='running' AND created<$3",owner,now(),now()-180000);
  // Include every unresolved job, even when it predates the recent-history window.
  return (await q("SELECT j.id,j.request_key,j.status,j.error,j.created,j.item_id,e.state AS quota_state FROM studio_image_jobs j LEFT JOIN studio_quota_entries e ON e.owner=j.owner AND e.request_key='media:image:'||j.request_key WHERE j.owner=$1 AND (j.status='running' OR (j.status='uncertain' AND (e.state IS NULL OR e.state='reserved')) OR j.id IN (SELECT id FROM studio_image_jobs WHERE owner=$1 ORDER BY created DESC,id DESC LIMIT 30)) ORDER BY j.created DESC,j.id DESC",owner)).map(jobDto);
 };
 const publicJob=async(owner,job)=>{
  if(job.status!=='uncertain')return jobDto(job);
  try{const entry=await one('SELECT state FROM studio_quota_entries WHERE owner=$1 AND request_key=$2',owner,'media:image:'+job.request_key);return jobDto({...job,quota_state:entry?.state})}catch{return jobDto(job)}
 };
 return async req=>{
  try{
   safeOrigin(req);const currentTime=now(),url=new URL(req.url),action=url.searchParams.get('action')||'status';
   const allowed=action==='list'?['action','page','pageSize']:action==='content'?['action','id','download']:['action'];if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))fail('请求字段无效');
   if(!['GET','POST'].includes(req.method))fail('请求方式无效',405);
   const raw=cookie(req),sessionHash=raw?hash(raw):'',user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',sessionHash,currentTime):null;
   if(!user)fail('请先登录',401);
   if(req.method==='GET'){
    if(action==='status')return json({configured,capabilities:{kinds:KINDS,ratios:RATIOS,resolutions:RESOLUTIONS,...IMAGE_LIMITS},wallet:await quota.summary(user.id),rates:await quota.rates(),jobs:await jobs(user.id)});
    if(action==='list'){
     const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||24);if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>24)fail('分页参数无效');
     const items=await q(ACTIVE_IMAGE+' WHERE i.owner=$1 AND a.admin_deleted=false ORDER BY i.created DESC,i.id DESC LIMIT $2 OFFSET $3',user.id,pageSize,(page-1)*pageSize),total=await one('SELECT count(*) AS total FROM studio_images i JOIN studio_asset_records a ON a.owner=i.owner AND a.project_id=i.project_id AND a.asset_id=i.id WHERE i.owner=$1 AND a.admin_deleted=false',user.id);
     return json({items:items.map(dto),jobs:await jobs(user.id),page,pageSize,total:Number(total.total)});
    }
    if(action==='content'){
     const imageId=url.searchParams.get('id')||'';if(!UUID.test(imageId))fail('图片标识无效');
     const saved=await one(IMAGE_DATA+' WHERE i.id=$1 AND (i.owner=$2 OR $3=true) AND a.admin_deleted=false',imageId,user.id,user.role==='admin');if(!saved)fail('图片不存在或无权访问',404);
     const file=validateImageData(saved.data_url),ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.mime],filename=(saved.name||'图片').replace(/[\r\n"\\/]/g,'_').slice(0,120)+'.'+ext;
     return new Response(file.buffer,{headers:{...NO_STORE,'Content-Type':file.mime,'Content-Length':String(file.bytes),'Content-Disposition':(url.searchParams.get('download')==='1'?'attachment':'inline')+`; filename="image.${ext}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    fail('图片接口不存在',404);
   }
   if(!['generate','import'].includes(action))fail('图片接口不存在',404);
   let body;try{body=JSON.parse(await boundedText(req,IMAGE_LIMITS.requestBytes))}catch(e){if(e.status)throw e;fail('请求格式错误')}
   const data=payload(body,action);
   if(action==='import'){
    const file=validateImageData(body.dataUrl),inputHash=hash(JSON.stringify({...data,contentHash:file.contentHash})),imageId=id();
    const saved={...data,...file,buffer:undefined,id:imageId,inputHash,source:'imported',ratio:'',resolution:'',contentUrl:url.origin+`/api/images?action=content&id=${imageId}`};
    const row=await one('SELECT studio_image_import($1,$2,$3,$4::jsonb,$5) AS item',user.id,sessionHash,user.session_version,JSON.stringify(saved),now());
    const current=await image(user.id,row.item.id);if(!current)fail('图片已不可用',409);return json({item:dto(current),wallet:await quota.summary(user.id)},201);
   }
   const references=[],referenceIds=[];
   for(const ref of data.references){keys(ref,Object.hasOwn(ref||{},'id')?['id']:['dataUrl']);if(Object.hasOwn(ref,'id')){
     if(typeof ref.id!=='string'||!UUID.test(ref.id))fail('参考图片标识无效');const saved=await image(user.id,ref.id,true);if(!saved)fail('参考图片不存在或无权访问',404);references.push(validateImageData(saved.data_url).dataUrl);referenceIds.push(ref.id);
    }else references.push(validateImageData(ref.dataUrl,IMAGE_LIMITS.referenceBytes).dataUrl)}
   const inputHash=hash(JSON.stringify({...data,references:references.map(hash)}));
   if(!configured)fail('图片生成尚未配置，请联系管理员',409);
   const rates=await quota.rates(),start=await one('SELECT studio_image_begin($1,$2,$3,$4::jsonb,$5,$6) AS result',user.id,sessionHash,user.session_version,JSON.stringify({...data,references:undefined,id:id(),inputHash}),rates.image,now());
   let job=start.result.job;
   if(start.result.started){
    try{
     const result=await (config.generate||((input)=>remoteGenerate(provider,input)))({prompt:data.prompt,ratio:data.ratio,resolution:data.resolution,references,requestId:data.requestId});
     const file=validateImageData(result?.dataUrl),imageId=job.id,saved={...data,...file,buffer:undefined,references:undefined,referenceIds,id:imageId,inputHash,source:'generated',contentUrl:url.origin+`/api/images?action=content&id=${imageId}`};
     job=(await one('SELECT studio_image_complete($1,$2,$3::jsonb,$4) AS job',user.id,job.id,JSON.stringify(saved),now())).job;
    }catch(e){
     // Never call the provider again for this request, including after a successful
     // response whose persistence or validation failed.
     job=(await one('SELECT studio_image_fail($1,$2,$3,$4) AS job',user.id,job.id,e.definite===true,now())).job;
    }
   }
   const current=job.item_id?await image(user.id,job.item_id):null;
   return json({job:await publicJob(user.id,job),...(current?{item:dto(current)}:{}),wallet:await quota.summary(user.id)},start.result.started?201:200);
  }catch(e){
   const msg=String(e.message||'');if(msg.includes('QUOTA_INSUFFICIENT'))return json({error:'估算 token 额度不足，请联系管理员增加额度'},409);
   if(msg.includes('IMAGE_SESSION_CHANGED'))return json({error:'登录状态已变化，请重新登录'},401);
   if(msg.includes('IMAGE_REQUEST_CONFLICT'))return json({error:'任务标识已用于其他内容，请创建新任务'},409);
   if(msg.includes('IMAGE_SOURCE_CONFLICT'))return json({error:'此历史图片已导入且内容不同，请核对后重新选择'},409);
   if(msg.includes('IMAGE_DELETED'))return json({error:'此图片已被管理员删除，请联系管理员'},409);
   if(msg.includes('IMAGE_BUSY'))return json({error:'已有图片正在生成，请等待完成'},429);
   return json({error:e.status?e.message:'图片服务暂不可用，请稍后查看任务状态'},e.status||503);
  }
 };
}
