import {AccountError,allowBearerOrigin} from './security.mjs';

const ASPECTS=new Set(['16:9','9:16','1:1','4:3','3:2','2:3']);
const MAX_VIDEO_BYTES=40*1024*1024;
const NO_STORE={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>Response.json(value,{status,headers:NO_STORE});

function fail(error){
 const status=error instanceof AccountError?error.status:502;
 return json({ok:false,error:error?.message||'出视频失败'},status);
}
function keyOf(env){
 const dedicated=typeof env.XAI_API_KEY==='string'?env.XAI_API_KEY.trim():'';
 if(dedicated)return dedicated;
 return typeof env.AI_API_KEY==='string'?env.AI_API_KEY.trim():'';
}
function baseOf(env){
 const raw=(typeof env.XAI_BASE_URL==='string'&&env.XAI_BASE_URL.trim())||(typeof env.AI_BASE_URL==='string'&&env.AI_BASE_URL.trim())||'https://api.x.ai/v1';
 const url=new URL(raw);
 if(url.protocol!=='https:'&&url.protocol!=='http:')throw new AccountError(500,'出视频地址无效');
 return url.toString().replace(/\/+$/,'');
}
async function readError(response){
 const text=await response.text();
 return text.slice(0,180);
}

export function createGrokVideoHandler(env=process.env){
 return async function handler(req){
  try{
   const key=keyOf(env);
   if(!key)return json({ok:false,error:'出视频服务还没接上'},503);
   const base=baseOf(env);
   if(req.method==='POST'){
    allowBearerOrigin(req);
    const body=await req.json().catch(()=>null);
    const prompt=String(body?.prompt||'').slice(0,4000).trim();
    if(!prompt)return json({ok:false,error:'没有画面要求'},400);
    const duration=Math.max(1,Math.min(15,Math.round(Number(body?.duration))||6));
    const aspect=ASPECTS.has(String(body?.aspect||''))?String(body.aspect):'16:9';
    const image=typeof body?.image==='string'&&body.image.startsWith('data:image/')?body.image:'';
    if(image.length>4500000)return json({ok:false,error:'首帧太大，请换一张较小的图'},400);
    const payload={model:env.XAI_VIDEO_MODEL||env.AI_VIDEO_MODEL||'grok-imagine-video-1.5',prompt,duration,aspect_ratio:aspect,resolution:'720p'};
    if(image)payload.image={url:image};
    const response=await fetch(base+'/videos/generations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(payload)});
    if(!response.ok)return json({ok:false,error:'出视频失败（'+response.status+'）'+await readError(response)},502);
    const started=await response.json();
    if(!started?.request_id)return json({ok:false,error:'出视频没有返回编号'},502);
    return json({ok:true,requestId:started.request_id});
   }
   if(req.method==='GET'){
    const id=new URL(req.url).searchParams.get('id')||'';
    if(!/^[A-Za-z0-9_-]{8,80}$/.test(id))return json({ok:false,error:'视频编号不对'},400);
    const response=await fetch(base+'/videos/'+id,{headers:{Authorization:'Bearer '+key}});
    if(!response.ok)return json({ok:false,error:'视频查询失败（'+response.status+'）'+await readError(response)},502);
    const result=await response.json();
    const status=result?.status||'pending';
    if(status==='failed'||status==='expired')return json({ok:true,status,error:result?.error||(status==='expired'?'视频生成超时':'视频生成失败')});
    if(status!=='done'||!result?.video?.url)return json({ok:true,status:status==='done'?'pending':status});
    const fileUrl=new URL(result.video.url);
    if(fileUrl.protocol!=='https:'&&fileUrl.protocol!=='http:')return json({ok:false,error:'生成视频地址无效'},502);
    const file=await fetch(fileUrl,{redirect:'follow'});
    if(!file.ok)return json({ok:false,error:'生成的视频下载失败'},502);
    const declared=Number(file.headers.get('content-length')||0);
    if(declared>MAX_VIDEO_BYTES)return json({ok:false,error:'生成的视频过大'},502);
    const mime=(file.headers.get('content-type')||'video/mp4').split(';')[0].trim();
    if(!mime.toLowerCase().startsWith('video/'))return json({ok:false,error:'生成结果不是视频'},502);
    const bytes=Buffer.from(await file.arrayBuffer());
    if(!bytes.length||bytes.byteLength>MAX_VIDEO_BYTES)return json({ok:false,error:'生成的视频过大'},502);
    return json({ok:true,status:'done',dataUrl:'data:'+mime+';base64,'+bytes.toString('base64')});
   }
   return json({ok:false,error:'方法不对'},405);
  }catch(error){return fail(error)}
 };
}
