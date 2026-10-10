import {createHash} from 'node:crypto';
import {AccountError,hash,token,cookie,safeOrigin,moduleUrl} from './security.mjs';

// Only applications owned by this studio can receive workbench identities.
export const SSO_ORIGINS=new Set(['https://sunny-terra-drift-arch.grok.me','https://jubaopeng-v2.vercel.app','https://jubaopeng-white.vercel.app']);
export const challengeFor=v=>createHash('sha256').update(v).digest('base64url');
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function effectiveModule(query,user,id){
 if(!['script','white','image','storyboard'].includes(id))throw new AccountError(400,'模型类型无效');
 const rows=await query('SELECT id,name,url FROM studio_model_modules WHERE id=$1',[id]);
 const m=rows[0];if(!m)throw new AccountError(404,'模型尚未配置');
 const binding=user.grok_account_id?(await query('SELECT url FROM studio_grok_modules WHERE grok_account_id=$1 AND module_id=$2',[user.grok_account_id,id]))[0]:null;
 const assigned=user.role==='user'&&['image','storyboard'].includes(id);
 const url=moduleUrl(binding?.url||(assigned?'':m.url));
 if(!url)throw new AccountError(409,'请让管理员配置已分配账户的模型页面地址');
 return {...m,url,origin:new URL(url).origin};
}
export function createSsoHandler(query){return async req=>{try{
 const now=Date.now();const action=new URL(req.url).searchParams.get('action');
 if(req.method!=='POST')throw new AccountError(405,'仅支持 POST');
 const raw=await req.text();if(raw.length>4096)throw new AccountError(413,'请求过大');
 let b;try{b=JSON.parse(raw)}catch{throw new AccountError(400,'请求格式错误')}
 if(action==='ticket'){
  safeOrigin(req);if(!valid(b.challenge))throw new AccountError(400,'登录校验无效');
  const sessionHash=hash(cookie(req));
  const u=(await query('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',[sessionHash,now]))[0];
  if(!u)throw new AccountError(401,'请先登录工作台');
  const m=await effectiveModule(query,u,b.module);
  if(!SSO_ORIGINS.has(m.origin))throw new AccountError(409,'此模型尚未接入统一登录');
  const code=token();await query('INSERT INTO studio_sso_tickets (code_hash,session_hash,user_id,module_id,audience,challenge,expires,consumed) VALUES ($1,$2,$3,$4,$5,$6,$7,false)',[hash(code),sessionHash,u.id,m.id,m.origin,b.challenge,now+60000]);
  return json({code,audience:m.origin});
 }
 if(action==='redeem'){
  // Redemption is server-to-server. Never expose identity through CORS.
  if(req.headers.get('origin'))throw new AccountError(403,'请通过模型服务验证登录');
  if(!valid(b.code)||!valid(b.verifier)||!SSO_ORIGINS.has(b.audience))throw new AccountError(400,'登录凭据无效');
  const ticket=(await query('SELECT * FROM studio_sso_tickets WHERE code_hash=$1 AND audience=$2 AND challenge=$3 AND expires>$4 AND consumed=false',[hash(b.code),b.audience,challengeFor(b.verifier),now]))[0];
  if(!ticket)throw new AccountError(401,'登录凭据已失效，请从工作台重新打开');
  const u=(await query('SELECT a.* FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',[ticket.session_hash,now]))[0];
  if(!u)throw new AccountError(401,'工作台登录已失效');
  const m=await effectiveModule(query,u,ticket.module_id);if(m.origin!==ticket.audience)throw new AccountError(403,'模型分配已变更');
  const consumed=await query('UPDATE studio_sso_tickets SET consumed=true WHERE code_hash=$1 AND consumed=false AND expires>$2 RETURNING user_id',[hash(b.code),now]);
  if(!consumed.length)throw new AccountError(401,'登录凭据已使用');
  return json({phone:u.phone,name:u.name,module:ticket.module_id});
 }
 throw new AccountError(404,'接口不存在');
 }catch(e){return json({error:e.status?e.message:'统一登录服务暂不可用'},e.status||503)}}}

export function launchPage(module,target,origin){
 const nonce=token();const args=JSON.stringify({module,target,origin}).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剧爆棚 · 模型</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{background:#111;color:#ddd;font-family:sans-serif}#error{padding:20px}</style></head><body><p id="error" hidden></p><iframe title="剧爆棚原模型" referrerpolicy="no-referrer" allow="clipboard-write" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox"></iframe><script nonce="${nonce}">
const d=${args},frame=document.querySelector('iframe');let issued=false;
window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!==d.origin||e.data?.type!=='jbp-sso-ready'||issued)return;if(!/^[A-Za-z0-9_-]{43}$/.test(e.data.challenge))return;issued=true;try{const r=await fetch('/api/sso?action=ticket',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:d.module,challenge:e.data.challenge})});const b=await r.json();if(!r.ok)throw Error(b.error);frame.contentWindow.postMessage({type:'jbp-sso-ticket',code:b.code},d.origin)}catch(err){const p=document.querySelector('#error');p.hidden=false;p.textContent=err.message;frame.hidden=true}});
frame.src=new URL('/api/studio-sso',d.target).href+'?next='+encodeURIComponent(new URL(d.target).pathname);
</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'`}});
}
