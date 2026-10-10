import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {hashPassword,verifyPassword,moduleUrl} from '../lib/security.mjs';
function setup(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const query=async(sql,p)=>{const stmt=db.prepare(sql);const params=Object.fromEntries(p.map((v,i)=>['$'+(i+1),typeof v==='boolean'?Number(v):v]));return stmt.all(params)};const handler=createAccountHandler(query,{setupToken:'test-setup-secret-with-32-characters'});const request=(action,method='GET',data,cookie='')=>handler(new Request('https://studio.test/api/accounts?action='+action,{method,headers:{Origin:'https://studio.test','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined}));return {db,request}}
async function seed(s){let r=await s.request('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13800000000',password:'administrator-password',name:'管理员'});assert.equal(r.status,201);r=await s.request('login','POST',{phone:'13800000000',password:'administrator-password'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
test('密码哈希有独立盐且拒绝错误密码',async()=>{const a=await hashPassword('strong-password'),b=await hashPassword('strong-password');assert.notEqual(a,b);assert.ok(await verifyPassword('strong-password',a));assert.equal(await verifyPassword('wrong-password',a),false)});
test('只有管理员能分配账户和打开 Grok，用户会话显示真实姓名和分配标识',async()=>{const s=setup(),admin=await seed(s);assert.equal((await s.request('users')).status,401);assert.equal((await s.request('grok-accounts','POST',{label:'主账户'},admin)).status,201);const grok=(await (await s.request('users','GET',null,admin)).json()).grokAccounts[0];assert.equal((await s.request('users','POST',{name:'学生甲',phone:'13900000000',password:'user-password-123',grokAccountId:grok.id,role:'admin'},admin)).status,201);const login=await s.request('login','POST',{phone:'13900000000',password:'user-password-123'}),user=login.headers.get('set-cookie').split(';')[0];const info=await login.json();assert.equal(info.user.name,'学生甲');assert.equal(info.user.role,'user');assert.equal(info.user.grokAccount,'主账户');assert.equal((await s.request('users','GET',null,user)).status,403);assert.equal((await s.request('grok-open','GET',null,user)).status,403);assert.equal((await s.request('grok-open','GET',null,admin)).status,302);assert.equal((await s.request('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13700000000',name:'另一个',password:'strong-password'})).status,409);assert.ok(!JSON.stringify(info).includes('password_hash'));s.db.close()});
test('停用或重置账户立即撤销旧会话，退出后会话失效',async()=>{const s=setup(),admin=await seed(s);await s.request('users','POST',{name:'乙',phone:'13900000001',password:'user-password-123'},admin);const login=await s.request('login','POST',{phone:'13900000001',password:'user-password-123'}),session=login.headers.get('set-cookie').split(';')[0],id=(await login.json()).user.id;await s.request('users','PUT',{id,name:'乙',active:false},admin);assert.equal((await (await s.request('me','GET',null,session)).json()).user,null);await s.request('logout','POST',{},admin);assert.equal((await (await s.request('me','GET',null,admin)).json()).user,null);s.db.close()});
test('拒绝跨站写入、密码重试过多、公开 Grok 模块和恶意地址',async()=>{const s=setup();const cross=await createAccountHandler(async()=>[],{})(new Request('https://studio.test/api/accounts?action=login',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}));assert.equal(cross.status,403);for(let i=0;i<10;i++)assert.equal((await s.request('login','POST',{phone:'13900000002',password:'wrong-password'})).status,401);assert.equal((await s.request('login','POST',{phone:'13900000002',password:'wrong-password'})).status,429);assert.throws(()=>moduleUrl('javascript:alert(1)'));assert.throws(()=>moduleUrl('https://grok.com/imagine'));assert.throws(()=>moduleUrl('https://site.test/?token=secret'));assert.equal(moduleUrl('https://jubaopeng-v2.vercel.app/'),'https://jubaopeng-v2.vercel.app/');s.db.close()});

test('首次初始化直接建立管理员会话，并关闭重复初始化',async()=>{const s=setup();assert.equal((await (await s.request('me')).json()).administratorConfigured,false);const r=await s.request('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13600000000',password:'administrator-password',name:'所有者'});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];assert.ok(r.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Strict'));const info=await (await s.request('me','GET',null,cookie)).json();assert.equal(info.user.role,'admin');assert.equal(info.user.name,'所有者');assert.equal(info.administratorConfigured,true);assert.equal((await s.request('users','GET',null,cookie)).status,200);s.db.close()});

test('独立模型入口按当前成员分配路由，禁止改写他人绑定与跳入 Grok 主站',async()=>{
const s=setup(),admin=await seed(s);
for(const id of ['image','storyboard'])await s.request('modules','PUT',{id,name:id,url:'https://public.grok.me/'},admin);
for(const label of ['账户甲','账户乙'])await s.request('grok-accounts','POST',{label},admin);
const accounts=(await (await s.request('users','GET',null,admin)).json()).grokAccounts;
const sessions=[];
for(let i=0;i<2;i++){
const grok=accounts[i];
assert.equal((await s.request('grok-modules','PUT',{grokAccountId:grok.id,moduleId:'image',url:`https://model-${i}.grok.me/`},admin)).status,200);
await s.request('users','POST',{name:`成员${i}`,phone:`1390000000${i}`,password:'user-password-123',grokAccountId:grok.id},admin);
const r=await s.request('login','POST',{phone:`1390000000${i}`,password:'user-password-123'});sessions.push(r.headers.get('set-cookie').split(';')[0]);
const modules=(await (await s.request('modules','GET',null,sessions[i])).json()).modules;
assert.equal(modules.find(m=>m.id==='image').url,`https://model-${i}.grok.me/`);
assert.equal(modules.find(m=>m.id==='storyboard').url,'');
const launch=await s.request('module-open&module=image&grokAccountId='+accounts[1-i].id,'GET',null,sessions[i]);assert.equal(launch.status,302);assert.equal(launch.headers.get('location'),`https://model-${i}.grok.me/`);
assert.equal((await s.request('module-open&module=storyboard','GET',null,sessions[i])).status,409);
assert.equal((await s.request('grok-modules','PUT',{grokAccountId:grok.id,moduleId:'image',url:'https://evil.test/'},sessions[i])).status,403);
}
assert.equal((await s.request('grok-modules','PUT',{grokAccountId:accounts[0].id,moduleId:'image',url:'https://grok.com/imagine'},admin)).status,400);
assert.equal((await s.request('module-open&module=image','GET',null,'__Host-jbp-session=expired')).status,401);
const users=(await (await s.request('users','GET',null,admin)).json()).users;
await s.request('users','PUT',{id:users.find(u=>u.phone==='13900000000').id,name:'成员0',grokAccountId:accounts[1].id,active:true},admin);
assert.equal((await s.request('module-open&module=image','GET',null,sessions[0])).status,401);
s.db.close();
});
