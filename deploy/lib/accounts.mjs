import {AccountError,phone,name,memberPassword,hashPassword,verifyPassword,requireAdmin,hash,token,cookie,safeOrigin,moduleUrl} from './security.mjs';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {SSO_ORIGINS,launchPage} from './sso.mjs';
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const cleanUser=u=>({id:u.id,name:u.name,phone:u.phone,role:u.role,grokAccount:u.role==='admin'?(u.grok_label||null):null,generationAssigned:!!u.grok_label});
async function read(req){const text=await req.text();if(text.length>16384)throw new AccountError(413,'请求过大');try{return JSON.parse(text)}catch{throw new AccountError(400,'请求格式错误')}}
export function createAccountHandler(query,config={}){
return async function handle(req){try{
safeOrigin(req);const op=new URL(req.url).searchParams.get('action')||'me';const now=Date.now();
const q=async(s,...p)=>query(s,p);const one=async(s,...p)=>(await q(s,...p))[0];
const rate=async(key,max)=>{const row=await one('INSERT INTO studio_login_limits (key,attempts,until_ms) VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN studio_login_limits.until_ms<$3 THEN 1 ELSE studio_login_limits.attempts+1 END, until_ms=CASE WHEN studio_login_limits.until_ms<$3 THEN $2 ELSE studio_login_limits.until_ms END RETURNING attempts',hash(key),now+15*60*1000,now);if(row.attempts>max)throw new AccountError(429,'尝试过多，请15分钟后再试')};
if(op==='login'&&req.method==='POST'){
const b=await read(req),p=phone(b.phone);await rate('phone:'+p,10);await rate('ip:'+(req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0],100);
const u=await one('SELECT a.*,g.label AS grok_label FROM studio_accounts a LEFT JOIN studio_grok_accounts g ON g.id=a.grok_account_id AND g.active=true WHERE phone=$1',p);
const dummy=config.dummyHash||await hashPassword('not-an-account-password');
if(!await verifyPassword(b.password,u?.password_hash||dummy)||!u?.active)throw new AccountError(401,'手机号或密码错误，或账号已停用');
const t=token();await q('INSERT INTO studio_sessions (token_hash,user_id,version,expires) VALUES ($1,$2,$3,$4)',hash(t),u.id,u.session_version,now+7*86400000);
return json({user:cleanUser(u)},200,{'Set-Cookie':`__Host-jbp-session=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
}
if(op==='bootstrap'&&req.method==='POST'){
await rate('bootstrap',5);const b=await read(req);const expected=hash(config.setupToken||''),actual=hash(String(b.setupToken||''));if(!config.setupToken||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))throw new AccountError(403,'初始化密钥无效');
if(await one("SELECT id FROM studio_accounts WHERE role='admin'"))throw new AccountError(409,'管理员已设置，不能重复初始化');
const id=randomUUID();await q("INSERT INTO studio_accounts (id,phone,name,password_hash,role,created) VALUES ($1,$2,$3,$4,'admin',$5)",id,phone(b.phone),name(b.name),await hashPassword(b.password),now);const t=token();await q('INSERT INTO studio_sessions (token_hash,user_id,version,expires) VALUES ($1,$2,$3,$4)',hash(t),id,1,now+7*86400000);return json({created:true,user:{id,name:name(b.name),phone:phone(b.phone),role:'admin',grokAccount:null}},201,{'Set-Cookie':`__Host-jbp-session=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
}
const raw=cookie(req);const u=raw?await one('SELECT a.*,g.label AS grok_label FROM studio_sessions s JOIN studio_accounts a ON a.id=s.user_id LEFT JOIN studio_grok_accounts g ON g.id=a.grok_account_id AND g.active=true WHERE s.token_hash=$1 AND s.expires>$2 AND a.active=true AND s.version=a.session_version',hash(raw),now):null;
if(op==='me'&&req.method==='GET')return json({user:u?cleanUser(u):null,configured:true,administratorConfigured:!!await one("SELECT id FROM studio_accounts WHERE role='admin'")});
if(op==='logout'&&req.method==='POST'){if(raw)await q('DELETE FROM studio_sessions WHERE token_hash=$1',hash(raw));return json({loggedOut:true},200,{'Set-Cookie':'__Host-jbp-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'})}
if((op==='modules'||op==='module-open')&&req.method==='GET'){
if(op==='modules')requireAdmin(u);
if(raw&&!u)throw new AccountError(401,'登录已失效，请返回工作台重新登录');
const modules=await q('SELECT id,name,url FROM studio_model_modules ORDER BY id');
let bindings=[];if(u?.grok_label)bindings=await q('SELECT module_id,url FROM studio_grok_modules WHERE grok_account_id=$1',u.grok_account_id);
const effective=modules.map(m=>{const b=bindings.find(b=>b.module_id===m.id);const assigned=u?.role==='user'&&['image','storyboard'].includes(m.id);return {...m,url:b?.url||(assigned?'':m.url),source:b?.url?'assigned':assigned?'unconfigured':'shared'}});
if(op==='modules')return json({modules:effective});
const id=new URL(req.url).searchParams.get('module');const m=effective.find(m=>m.id===id);if(!m)throw new AccountError(400,'模型类型无效');if(!m.url)throw new AccountError(409,'请让管理员配置已分配账户的模型页面地址');
const origin=new URL(moduleUrl(m.url)).origin;
if(u&&SSO_ORIGINS.has(origin)){
try{const r=await (config.fetch||fetch)(origin+'/api/studio-sso?action=capabilities',{signal:AbortSignal.timeout(2000),redirect:'error'});const capability=r.ok?await r.json():null;if(capability?.protocol==='jbp-sso-pkce-v1')return launchPage(id,m.url,origin)}catch{/* Original model remains usable until its SSO adapter is published. */}
}
return new Response(null,{status:302,headers:{Location:moduleUrl(m.url),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
requireAdmin(u);
const audit=async(action,target)=>q('INSERT INTO studio_account_audit (id,actor,action,target,created) VALUES ($1,$2,$3,$4,$5)',randomUUID(),u.id,action,target,now);
if(op==='grok-open'&&req.method==='GET')return new Response(null,{status:302,headers:{Location:'https://grok.com/imagine','Cache-Control':'no-store'}});
if(op==='users'&&req.method==='GET')return json({users:await q('SELECT a.id,a.phone,a.name,a.role,a.active,a.grok_account_id,g.label AS grok_label FROM studio_accounts a LEFT JOIN studio_grok_accounts g ON g.id=a.grok_account_id ORDER BY a.created DESC'),grokAccounts:await q('SELECT id,label,active FROM studio_grok_accounts ORDER BY label'),grokModules:await q('SELECT grok_account_id,module_id,url FROM studio_grok_modules')});
if(op==='grok-modules'&&req.method==='PUT'){const b=await read(req);if(!['script','white','image','storyboard'].includes(b.moduleId))throw new AccountError(400,'模型类型无效');if(!await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND active=true',String(b.grokAccountId)))throw new AccountError(400,'请选择有效的 Grok 账户');const url=moduleUrl(b.url);await q('INSERT INTO studio_grok_modules (grok_account_id,module_id,url,updated) VALUES ($1,$2,$3,$4) ON CONFLICT(grok_account_id,module_id) DO UPDATE SET url=excluded.url,updated=excluded.updated',b.grokAccountId,b.moduleId,url,now);await audit('configure-grok-module',b.grokAccountId+':'+b.moduleId);return json({saved:true})}
if(op==='grok-accounts'&&req.method==='POST'){
const b=await read(req),input=b.labels===undefined?[b.label]:b.labels;
if(!Array.isArray(input)||!input.length||input.length>50)throw new AccountError(400,'每次请输入1–50个账户');
const labels=[...new Set(input.map(v=>name(v)))],params=[];
const values=labels.map(label=>{params.push(randomUUID(),label);return `($${params.length-1},$${params.length})`}).join(',');
const added=await q('INSERT INTO studio_grok_accounts (id,label) VALUES '+values+' ON CONFLICT(label) DO NOTHING RETURNING id',...params);
for(const row of added)await audit('create-grok-label',row.id);
return json({created:true,added:added.length,skipped:input.length-added.length},201)}
if(op==='grok-accounts'&&req.method==='PUT'){
const b=await read(req),id=String(b.id),label=name(b.label);
if(typeof b.active!=='boolean')throw new AccountError(400,'账户状态无效');
const updated=await one('UPDATE studio_grok_accounts SET label=$1,active=$2 WHERE id=$3 RETURNING id',label,b.active,id);
if(!updated)throw new AccountError(404,'Grok 账户不存在');
await audit('update-grok-label',id);return json({saved:true})}
if(op==='assign-grok'&&req.method==='PUT'){
const b=await read(req),id=String(b.id),grok=b.grokAccountId||null;
if(grok&&!await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND active=true',grok))throw new AccountError(400,'请选择启用的 Grok 账户');
const updated=await one("UPDATE studio_accounts SET grok_account_id=$1,session_version=session_version+1 WHERE id=$2 AND role='user' RETURNING id",grok,id);
if(!updated)throw new AccountError(404,'成员账户不存在');
await audit('assign-grok',id);return json({saved:true})}
if(op==='modules'&&req.method==='PUT'){const b=await read(req);if(!['script','white','image','storyboard'].includes(b.id))throw new AccountError(400,'模型类型无效');await q('INSERT INTO studio_model_modules (id,name,url,updated) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,updated=excluded.updated',b.id,name(b.name),moduleUrl(b.url),now);await audit('configure-module',b.id);return json({saved:true})}
if(op==='users'&&req.method==='POST'){const b=await read(req),id=randomUUID(),p=phone(b.phone),n=name(b.name),pwd=memberPassword(b.password);if(await one('SELECT id FROM studio_accounts WHERE phone=$1',p))throw new AccountError(409,'手机号已存在，请在“已有账户”中编辑或重置密码');const grok=b.grokAccountId||null;if(grok&&!await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND active=true',grok))throw new AccountError(400,'请选择有效的 Grok 账户');const inserted=await one("INSERT INTO studio_accounts (id,phone,name,password_hash,role,grok_account_id,created) VALUES ($1,$2,$3,$4,'user',$5,$6) ON CONFLICT(phone) DO NOTHING RETURNING id",id,p,n,await hashPassword(pwd),grok,now);if(!inserted)throw new AccountError(409,'手机号已存在，请在“已有账户”中编辑或重置密码');await audit('create-user',id);return json({created:true},201)}
if(op==='users'&&req.method==='PUT'){const b=await read(req),target=await one('SELECT * FROM studio_accounts WHERE id=$1',String(b.id));if(!target)throw new AccountError(404,'账户不存在');if(target.role==='admin')throw new AccountError(400,'此入口不能修改管理员');const grok=b.grokAccountId||null;if(grok&&!await one('SELECT id FROM studio_grok_accounts WHERE id=$1 AND active=true',grok))throw new AccountError(400,'请选择有效的 Grok 账户');const encoded=b.password?await hashPassword(memberPassword(b.password)):target.password_hash;await q('UPDATE studio_accounts SET name=$1,grok_account_id=$2,active=$3,password_hash=$4,session_version=session_version+1 WHERE id=$5',name(b.name),grok,b.active!==false,encoded,target.id);await audit('update-user',target.id);return json({saved:true})}
throw new AccountError(404,'接口不存在');
}catch(e){if(e.code==='23505')return json({error:'手机号、账户名称或管理员已存在'},409);if(!e.status)console.error('account-service',e.code||e.name);return json({error:e.status?e.message:'账户服务暂不可用'},e.status||503)}};
}
