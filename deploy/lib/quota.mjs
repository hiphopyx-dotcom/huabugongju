import {randomUUID} from 'node:crypto';
import {AccountError,hash,cookie,safeOrigin,requireAdmin} from './security.mjs';
import {estimateText,estimateMedia,TEXT_OUTPUT_HOLD} from '../../public/studio/token-estimate.mjs';
const number=(v,max=1e12)=>{if(!Number.isSafeInteger(v)||v<0||v>max)throw new AccountError(400,'请输入有效的非负整数');return v};
export function createQuotaService(query){
 const q=(s,...p)=>query(s,p),one=async(s,...p)=>(await q(s,...p))[0];
 async function change(owner,key,op,kind,amount,detail,now=Date.now()){
  try{return (await one('SELECT studio_quota_change($1,$2,$3,$4,$5,$6,$7) AS entry',owner,key,op,kind,amount,detail,now)).entry}
  catch(e){const s=String(e.message);if(s.includes('QUOTA_INSUFFICIENT'))throw new AccountError(409,'估算 token 额度不足，请联系管理员增加额度');if(s.includes('QUOTA_BELOW_USED'))throw new AccountError(409,'总额度不能低于已消耗与预占之和，请先处理待生成任务');throw e}
 }
 async function reconcile(owner,now=Date.now()){
  await q("UPDATE studio_generation_jobs SET status='failed',error='执行超时或排队已过期，未自动重复调用',updated=$2 WHERE owner=$1 AND ((status='running' AND leased_until<=$2) OR (status='queued' AND created<$3))",owner,now,now-900000);
  const jobs=await q("SELECT j.request_key,j.status,j.prompt,j.result FROM studio_quota_entries e JOIN studio_generation_jobs j ON j.owner=e.owner AND e.request_key='text:'||j.request_key WHERE e.owner=$1 AND e.state='reserved' AND j.status IN ('done','failed')",owner);
  for(const j of jobs)await change(owner,'text:'+j.request_key,j.status==='done'?'charge':'release','text',j.status==='done'?estimateText(j.prompt)+estimateText(j.result):0,'',now);
 }
 async function summary(owner){await reconcile(owner);const w=await one("SELECT w.allowance,COALESCE(sum(e.charged),0) AS used,COALESCE(sum(CASE WHEN e.state='reserved' THEN e.reserved ELSE 0 END),0) AS held FROM studio_quota_wallets w LEFT JOIN studio_quota_entries e ON e.owner=w.owner WHERE w.owner=$1 GROUP BY w.allowance",owner);const allowance=w?.allowance==null?null:Number(w.allowance),used=Number(w?.used||0),held=Number(w?.held||0);return {allowance,used,held,available:allowance===null?null:Math.max(0,allowance-used-held)}}
 async function rates(){const r=await one('SELECT image,video_second FROM studio_quota_rates WHERE id=1');return {image:Number(r.image),videoSecond:Number(r.video_second)}}
 async function submitText({id,user,account,requestId,prompt,now}){await reconcile(user.id,now);try{await q('SELECT studio_quota_text_submit($1,$2,$3,$4,$5,$6,$7,$8)',id,user.id,account,user.session_version,requestId,prompt,estimateText(prompt)+TEXT_OUTPUT_HOLD,now)}catch(e){if(String(e.message).includes('QUOTA_INSUFFICIENT'))throw new AccountError(409,'估算 token 额度不足：文字按最大输出预占，完成后退回差额，请联系管理员');throw e}}
 return {q,one,change,reconcile,summary,rates,submitText};
}
export function createQuotaHandler(query,config={}){const service=createQuotaService(query),{q,one,change,summary,rates}=service;return async req=>{try{
 safeOrigin(req);const now=config.now?.()??Date.now(),url=new URL(req.url),action=url.searchParams.get('action')||'status';
 const raw=cookie(req),user=raw?await one('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),now):null;
 if(!user)throw new AccountError(401,'请先登录');
 let body={};if(req.method==='POST'){const text=await req.text();if(Buffer.byteLength(text)>20000)throw new AccountError(413,'请求过大');try{body=JSON.parse(text)}catch{throw new AccountError(400,'请求格式错误')}if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountError(400,'请求格式错误')}
 const owner=String((req.method==='GET'?url.searchParams.get('owner'):body.owner)||user.id);if(owner!==user.id)requireAdmin(user);
 if(!await one('SELECT id FROM studio_accounts WHERE id=$1',owner))throw new AccountError(404,'账号不存在');
 const audit=(act,detail)=>q('INSERT INTO studio_quota_audit(id,actor,owner,action,detail,created) VALUES($1,$2,$3,$4,$5,$6)',randomUUID(),user.id,owner,act,JSON.stringify(detail),now);
 if(action==='status'&&req.method==='GET')return Response.json({wallet:await summary(owner),rates:await rates(),textOutputHold:TEXT_OUTPUT_HOLD},{headers:{'Cache-Control':'no-store'}});
 if(action==='ledger'&&req.method==='GET'){const wallet=await summary(owner);return Response.json({wallet,entries:await q('SELECT request_key,kind,state,reserved,charged,detail,created,updated FROM studio_quota_entries WHERE owner=$1 ORDER BY created DESC,request_key LIMIT 100',owner),audit:user.role==='admin'?await q('SELECT action,detail,created FROM studio_quota_audit WHERE owner=$1 ORDER BY created DESC LIMIT 30',owner):[]},{headers:{'Cache-Control':'no-store'}})}
 if(action==='users'&&req.method==='GET'){requireAdmin(user);const users=await q('SELECT id,name,phone FROM studio_accounts ORDER BY created');return Response.json({users:await Promise.all(users.map(async u=>({...u,wallet:await summary(u.id)}))),rates:await rates()},{headers:{'Cache-Control':'no-store'}})}
 if(req.method!=='POST')throw new AccountError(405,'请使用POST');
 if(action==='limit'){requireAdmin(user);const amount=body.allowance===null?null:number(body.allowance);await change(owner,'','limit','text',amount,'',now);await audit('set-limit',{allowance:amount});return Response.json({wallet:await summary(owner)})}
 if(action==='rates'){requireAdmin(user);const image=number(body.image,10000000),video=number(body.videoSecond,10000000);if(!image||!video)throw new AccountError(400,'估算系数至少为1');await q('UPDATE studio_quota_rates SET image=$1,video_second=$2,updated=$3 WHERE id=1',image,video,now);await audit('set-rates',{image,videoSecond:video});return Response.json({rates:await rates()})}
 if(action==='reserve'){
  if(owner!==user.id)throw new AccountError(403,'请由生成任务所属账号提交');
  if(typeof body.requestId!=='string'||!/^media:[A-Za-z0-9_-]{1,100}$/.test(body.requestId))throw new AccountError(400,'任务标识无效');
  let amount;try{amount=estimateMedia(body.kind,{count:body.count,seconds:body.seconds},await rates())}catch(e){throw new AccountError(400,e.message)}
  const detail=JSON.stringify({name:String(body.name||'生成任务').slice(0,100),count:body.count,seconds:body.kind==='video'?body.seconds:null,prompt:String(body.prompt||'').slice(0,8000)});
  const entry=await change(owner,body.requestId,'reserve',body.kind,amount,detail,now);return Response.json({entry,wallet:await summary(owner)}, {status:201});
 }
 if(action==='charge'||action==='release'){
  requireAdmin(user);const key=String(body.requestId||'');if(!key.startsWith('media:'))throw new AccountError(400,'文字任务由系统自动结算');
  const entry=await one('SELECT * FROM studio_quota_entries WHERE owner=$1 AND request_key=$2',owner,key);if(!entry)throw new AccountError(404,'请求不存在');
  if(action==='charge'&&body.confirmed!==true)throw new AccountError(400,'请核对真实生成结果后确认结算');
  const saved=await change(owner,key,action,entry.kind,Number(entry.reserved),'',now);await audit(action,{requestId:key,state:saved.state});return Response.json({entry:saved,wallet:await summary(owner)});
 }
 throw new AccountError(404,'额度接口不存在');
 }catch(e){if(!e.status)console.error('quota-service',e.code||e.name);return Response.json({error:e.status?e.message:'额度服务暂不可用，请稍后重试'},{status:e.status||503,headers:{'Cache-Control':'no-store'}})}}}
