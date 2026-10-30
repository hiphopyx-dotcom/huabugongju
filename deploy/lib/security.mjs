import {randomBytes,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export class AccountError extends Error{constructor(status,message){super(message);this.status=status}}
export function phone(value){const p=String(value||'').trim().replace(/[\s()-]/g,'');if(!/^\+?[0-9]{7,15}$/.test(p))throw new AccountError(400,'请输入有效手机号（含国家码时加 +）');return p}
export function password(value){if(typeof value!=='string'||value.length<6||value.length>128)throw new AccountError(400,'密码需要6–128个字符');return value}
export function memberPassword(value){if(typeof value!=='string'||value.length<6||value.length>8)throw new AccountError(400,'成员密码需要6–8个字符');return value}
export function name(value){const n=String(value||'').trim();if(!n||n.length>60)throw new AccountError(400,'姓名需要1–60个字符');return n}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export async function hashPassword(value){password(value);const salt=randomBytes(16).toString('hex');const key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt:${salt}:${key.toString('hex')}`}
export async function verifyPassword(value,encoded){if(typeof value!=='string'||value.length>128)return false;const [kind,salt,hex]=String(encoded||'').split(':');if(kind!=='scrypt'||!salt||!hex)return false;const key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(hex,'hex');return expected.length===key.length&&timingSafeEqual(expected,key)}
export function requireAdmin(user){if(!user)throw new AccountError(401,'请先登录');if(user.role!=='admin')throw new AccountError(403,'仅管理员可操作');return user}
export function moduleUrl(value){if(!value)return '';let u;try{u=new URL(value)}catch{throw new AccountError(400,'模型地址无效')}if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(u.hostname))throw new AccountError(400,'请使用无密码、无查询参数的 HTTPS 页面地址');if(u.hostname==='grok.com'||u.hostname.endsWith('.grok.com'))throw new AccountError(400,'Grok 入口只能由管理员使用');return u.href}
export function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-jbp-session='))?.slice(19)||''}
export function safeOrigin(req){if(req.method==='GET'||req.method==='OPTIONS')return;const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new AccountError(403,'请在当前网站内操作')}

/** Exact origins only. Default is the preview bench. JBP_CORS_ORIGINS replaces it; no wildcards or suffix matches. */
export const DEFAULT_CORS_ORIGIN='https://zinc-raven-rocket-drift.grok.me';
const BEARER=/^Bearer ([A-Za-z0-9_-]{43})$/;
export const BEARER_SESSION_MS=24*60*60*1000;
export const COOKIE_SESSION_MS=7*86400000;
export const CROSS_ORIGIN_ADMIN_ACTIONS=new Set(['grok-accounts','assign-grok','bootstrap','worker-config','worker-revoke','script-worker-config']);

export function allowedOrigins(env=process.env){
  const raw=env.JBP_CORS_ORIGINS;
  const list=raw==null||String(raw).trim()===''?[DEFAULT_CORS_ORIGIN]:String(raw).split(',').map(s=>s.trim()).filter(Boolean);
  const set=new Set();
  for(const origin of list){
    if(origin.includes('*')||origin.endsWith('/'))throw new AccountError(500,'CORS 源必须精确匹配');
    let url;try{url=new URL(origin)}catch{throw new AccountError(500,'CORS 源无效')}
    if(url.origin!==origin)throw new AccountError(500,'CORS 源必须精确匹配');
    set.add(origin);
  }
  return set;
}
export function bearerToken(req){return req.headers.get('authorization')?.match(BEARER)?.[1]||''}
/** Prefer a well-formed Authorization bearer. A present Authorization header never falls back to the cookie. */
export function sessionToken(req){if(req.headers.has('authorization'))return bearerToken(req);return cookie(req)}
export function isCrossOrigin(req){const origin=req.headers.get('origin')||'';return !!origin&&origin!==new URL(req.url).origin}
export function allowBearerOrigin(req){
  if(req.method==='GET'||req.method==='OPTIONS')return;
  const origin=req.headers.get('origin')||'';
  if(origin&&origin===new URL(req.url).origin)return;
  if(origin&&allowedOrigins().has(origin)&&bearerToken(req))return;
  throw new AccountError(403,'请在当前网站内操作');
}
export function refuseCrossOriginAdmin(req,action){
  if(CROSS_ORIGIN_ADMIN_ACTIONS.has(action)&&isCrossOrigin(req))throw new AccountError(403,'此操作只能在正式版网站内进行');
}
export function corsHeaders(req,env=process.env){
  const origin=req.headers.get('origin')||'';
  if(!allowedOrigins(env).has(origin))return {};
  return {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'};
}
export function applyCors(req,res,env=process.env){
  const extra=corsHeaders(req,env);
  if(!extra['Access-Control-Allow-Origin'])return res;
  const headers=new Headers(res.headers);
  for(const [key,value] of Object.entries(extra)){
    if(key==='Vary'){const prev=headers.get('Vary');headers.set('Vary',prev&&!prev.toLowerCase().includes('origin')?prev+', Origin':prev||value)}
    else headers.set(key,value);
  }
  return new Response(res.body,{status:res.status,statusText:res.statusText,headers});
}
export function preflight(req,env=process.env){
  if(req.method!=='OPTIONS')return null;
  const headers=corsHeaders(req,env);
  if(!headers['Access-Control-Allow-Origin'])return new Response(null,{status:403,headers:{Vary:'Origin','Cache-Control':'no-store'}});
  return new Response(null,{status:204,headers:{...headers,'Cache-Control':'no-store'}});
}
export function withCors(handler,env=process.env){
  return async function corsWrapped(req){
    const early=preflight(req,env);if(early)return early;
    return applyCors(req,await handler(req),env);
  };
}
