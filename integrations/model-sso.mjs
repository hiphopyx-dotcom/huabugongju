import {randomBytes} from 'node:crypto';
export const WORKBENCH='https://jubaopeng-canvas.vercel.app';
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export function safeNext(value){const u=new URL(typeof value==='string'?value:'/studio','https://model.invalid');return u.origin==='https://model.invalid'&&!u.pathname.startsWith('/api/')?u.pathname+u.search:'/studio'}
export function bridgePage(next){
 const nonce=randomBytes(24).toString('base64url');
 const destination=JSON.stringify(safeNext(next)).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剧爆棚 · 同步登录</title><style>body{background:#141210;color:#f3ece4;font-family:sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center}p{color:#c4bcb4}a{color:#d6fb68}</style></head><body><main><h2>剧爆棚</h2><p id="status">正在同步工作台登录…</p><a href="/login" id="manual" hidden>返回手机号登录</a></main><script nonce="${nonce}">
(async()=>{const workbench=${JSON.stringify(WORKBENCH)},next=${destination};let busy=false;
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const verifier=encode(crypto.getRandomValues(new Uint8Array(32))),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
const fail=message=>{document.querySelector('#status').textContent=message;document.querySelector('#manual').hidden=false};
const timer=setTimeout(()=>fail('同步未完成，请从剧爆棚工作台重新打开。'),15000);
window.addEventListener('message',async e=>{if(e.source!==parent||e.origin!==workbench||e.data?.type!=='jbp-sso-ticket'||busy||!/^[A-Za-z0-9_-]{43}$/.test(e.data.code))return;busy=true;clearTimeout(timer);try{const r=await fetch('/api/studio-sso',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:e.data.code,verifier})});const b=await r.json();if(!r.ok)throw Error(b.error||'同步登录失败');let stored=false;const user=JSON.stringify(b.user);for(const getStorage of [()=>localStorage,()=>sessionStorage]){try{const s=getStorage();s.setItem('grok-auth.bearer-token',b.token);s.setItem('grok-auth.user',user);stored=true}catch{}}if(!stored)throw Error('浏览器限制了模型登录存储，请允许此页面的存储。');location.replace(next)}catch(err){fail(err.message)}});
if(parent===window){clearTimeout(timer);fail('请从剧爆棚工作台打开此模型。');return}parent.postMessage({type:'jbp-sso-ready',challenge},workbench);
})().catch(()=>{document.querySelector('#status').textContent='浏览器无法完成统一登录，请使用手机号登录。';document.querySelector('#manual').hidden=false});
</script></body></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`frame-ancestors ${WORKBENCH}`}});
}
export function createModelSsoHandler({audience,signIn,fetcher=fetch}){return async request=>{try{
 const url=new URL(request.url);
 if(request.method==='GET')return url.searchParams.get('action')==='capabilities'?Response.json({protocol:'jbp-sso-pkce-v1'},{headers}):bridgePage(url.searchParams.get('next')||'/studio');
 if(request.method!=='POST')return Response.json({error:'请求方式无效'},{status:405,headers});
 if(request.headers.get('origin')!==audience)return Response.json({error:'请在原模型内同步登录'},{status:403,headers});
 const raw=await request.text();if(raw.length>4096)return Response.json({error:'请求过大'},{status:413,headers});
 let b;try{b=JSON.parse(raw)}catch{return Response.json({error:'请求格式错误'},{status:400,headers})}
 if(!valid(b.code)||!valid(b.verifier))return Response.json({error:'登录凭据无效'},{status:400,headers});
 const r=await fetcher(WORKBENCH+'/api/sso?action=redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:b.code,verifier:b.verifier,audience}),signal:AbortSignal.timeout(8000),redirect:'error'});
 const identity=await r.json();if(!r.ok)return Response.json({error:identity.error||'工作台登录已失效'},{status:r.status,headers});
 if(typeof identity.phone!=='string'||!/^\+?[0-9]{7,15}$/.test(identity.phone))throw Error('Invalid identity');
 // Resolve an existing local member. The workbench cannot create/promote admins.
 const signed=await signIn(identity.phone);if(!signed?.token||!signed?.user?.id)return Response.json({error:'这个手机号尚未在原模型开通，请让管理员配置原模型账户。'},{status:403,headers});
 const h=new Headers(headers);for(const c of signed.cookies||[])h.append('Set-Cookie',c);
 return Response.json({token:signed.token,user:{id:signed.user.id,displayName:signed.user.name||identity.name,primaryEmail:signed.user.email||null,profileImageUrl:null}},{headers:h});
 }catch{return Response.json({error:'原模型统一登录暂不可用，请稍后重试'},{status:503,headers})}}}
