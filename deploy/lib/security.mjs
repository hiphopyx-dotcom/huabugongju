import {randomBytes,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export class AccountError extends Error{constructor(status,message){super(message);this.status=status}}
export function phone(value){const p=String(value||'').trim().replace(/[\s()-]/g,'');if(!/^\+?[0-9]{7,15}$/.test(p))throw new AccountError(400,'请输入有效手机号（含国家码时加 +）');return p}
export function password(value){if(typeof value!=='string'||value.length<10||value.length>128)throw new AccountError(400,'密码需要10–128个字符');return value}
export function name(value){const n=String(value||'').trim();if(!n||n.length>60)throw new AccountError(400,'姓名需要1–60个字符');return n}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export async function hashPassword(value){password(value);const salt=randomBytes(16).toString('hex');const key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt:${salt}:${key.toString('hex')}`}
export async function verifyPassword(value,encoded){if(typeof value!=='string'||value.length>128)return false;const [kind,salt,hex]=String(encoded||'').split(':');if(kind!=='scrypt'||!salt||!hex)return false;const key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(hex,'hex');return expected.length===key.length&&timingSafeEqual(expected,key)}
export function requireAdmin(user){if(!user)throw new AccountError(401,'请先登录');if(user.role!=='admin')throw new AccountError(403,'仅管理员可操作');return user}
export function moduleUrl(value){if(!value)return '';let u;try{u=new URL(value)}catch{throw new AccountError(400,'模型地址无效')}if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(u.hostname))throw new AccountError(400,'请使用无密码、无查询参数的 HTTPS 页面地址');if(u.hostname==='grok.com'||u.hostname.endsWith('.grok.com'))throw new AccountError(400,'Grok 入口只能由管理员使用');return u.href}
export function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-jbp-session='))?.slice(19)||''}
export function safeOrigin(req){if(req.method==='GET')return;const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new AccountError(403,'请在当前网站内操作')}
