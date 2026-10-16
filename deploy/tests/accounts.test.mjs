import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {hashPassword,verifyPassword,moduleUrl} from '../lib/security.mjs';
function setup(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const query=async(sql,p)=>{const stmt=db.prepare(sql);const params=Object.fromEntries(p.map((v,i)=>['$'+(i+1),typeof v==='boolean'?Number(v):v]));return stmt.all(params)};const handler=createAccountHandler(query,{setupToken:'test-setup-secret-with-32-characters'});const request=(action,method='GET',data,cookie='')=>handler(new Request('https://studio.test/api/accounts?action='+action,{method,headers:{Origin:'https://studio.test','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined}));return {db,request}}
async function seed(s){let r=await s.request('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13800000000',password:'administrator-password',name:'管理员'});assert.equal(r.status,201);r=await s.request('login','POST',{phone:'13800000000',password:'administrator-password'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
test('密码哈希有独立盐且拒绝错误密码',async()=>{const a=await hashPassword('strong-password'),b=await hashPassword('strong-password');assert.notEqual(a,b);assert.ok(await verifyPassword('strong-password',a));assert.equal(await verifyPassword('wrong-password',a),false)});
test('只有管理员能分配账户和打开 Grok，用户会话显示真实姓名和分配标识',async()=>{const s=setup(),admin=await seed(s);assert.equal((await s.request('users')).status,401);assert.equal((await s.request('grok-accounts','POST',{label:'主账户'},admin)).status,201);const grok=(await (await s.request('users','GET',null,admin)).json()).grokAccounts[0];assert.equal((await s.request('users','POST',{name:'学生甲',phone:'13900000000',password:'member12',grokAccountId:grok.id,role:'admin'},admin)).status,201);const login=await s.request('login','POST',{phone:'13900000000',password:'member12'}),user=login.headers.get('set-cookie').split(';')[0];const info=await login.json();assert.equal(info.user.name,'学生甲');assert.equal(info.user.role,'user');assert.equal(info.user.grokAccount,'主账户');assert.equal((await s.request('users','GET',null,user)).status,403);assert.equal((await s.request('grok-open','GET',null,user)).status,403);assert.equal((await s.request('grok-open','GET',null,admin)).status,302);assert.equal((await s.request('bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13700000000',name:'另一个',password:'strong-password'})).status,409);assert.ok(!JSON.stringify(info).includes('password_hash'));s.db.close()});
test('停用或重置账户立即撤销旧会话，退出后会话失效',async()=>{const s=setup(),admin=await seed(s);await s.request('users','POST',{name:'乙',phone:'13900000001',password:'member12'},admin);const login=await s.request('login','POST',{phone:'13900000001',password:'member12'}),session=login.headers.get('set-cookie').split(';')[0],id=(await login.json()).user.id;await s.request('users','PUT',{id,name:'乙',active:false},admin);assert.equal((await (await s.request('me','GET',null,session)).json()).user,null);await s.request('logout','POST',{},admin);assert.equal((await (await s.request('me','GET',null,admin)).json()).user,null);s.db.close()});
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
await s.request('users','POST',{name:`成员${i}`,phone:`1390000000${i}`,password:'member12',grokAccountId:grok.id},admin);
const r=await s.request('login','POST',{phone:`1390000000${i}`,password:'member12'});sessions.push(r.headers.get('set-cookie').split(';')[0]);
assert.equal((await s.request('modules','GET',null,sessions[i])).status,403);
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
test('成员分配支持6至8位密码，短密码可登录并重置，旧长密码仍可登录',async()=>{const s=setup(),admin=await seed(s);for(const [i,pwd] of ['123456','abc1234','pass1234'].entries()){const phone='1350000000'+i;const created=await s.request('users','POST',{name:'短密码成员'+i,phone,password:pwd},admin);assert.equal(created.status,201,JSON.stringify(await created.json()));const login=await s.request('login','POST',{phone,password:pwd});assert.equal(login.status,200);const info=await login.json(),oldSession=login.headers.get('set-cookie').split(';')[0];assert.equal(info.user.name,'短密码成员'+i);const reset=await s.request('users','PUT',{id:info.user.id,name:info.user.name,password:'87654321',active:true},admin);assert.equal(reset.status,200);assert.equal((await (await s.request('me','GET',null,oldSession)).json()).user,null);assert.equal((await s.request('login','POST',{phone,password:'87654321'})).status,200)}const legacyHash=await hashPassword('legacy-long-password');s.db.prepare('UPDATE studio_accounts SET password_hash=? WHERE phone=?').run(legacyHash,'13500000000');assert.equal((await s.request('login','POST',{phone:'13500000000',password:'legacy-long-password'})).status,200);for(const password of ['12345','123456789']){const r=await s.request('users','POST',{name:'长度不合规',phone:'13400000000',password},admin);assert.equal(r.status,400);assert.match((await r.json()).error,/6.*8/)}s.db.close()});
test('重复分配手机号给出明确提示，原成员绑定和密码保持有效',async()=>{const s=setup(),admin=await seed(s);await s.request('users','POST',{name:'原成员',phone:'13300000000',password:'123456'},admin);const r=await s.request('users','POST',{name:'重复成员',phone:'133 0000 0000',password:'654321'},admin);assert.equal(r.status,409);assert.match((await r.json()).error,/手机号已存在/);assert.equal((await s.request('login','POST',{phone:'13300000000',password:'123456'})).status,200);s.db.close()});

test('管理员批量登记账户、改名停用，并独立改绑或解除手机号绑定',async()=>{
const s=setup(),admin=await seed(s);
let r=await s.request('grok-accounts','POST',{labels:['甲@example.com','乙@example.com','甲@example.com']},admin);assert.equal(r.status,201);assert.equal((await r.json()).added,2);
r=await s.request('grok-accounts','POST',{labels:['甲@example.com']},admin);assert.equal(r.status,201);assert.equal((await r.json()).added,0);
let pool=(await (await s.request('users','GET',null,admin)).json()).grokAccounts;const [a,b]=pool;
await s.request('users','POST',{name:'成员',phone:'13900000008',password:'123456',grokAccountId:a.id},admin);
let login=await s.request('login','POST',{phone:'13900000008',password:'123456'}),session=login.headers.get('set-cookie').split(';')[0],id=(await login.json()).user.id;
assert.equal((await s.request('assign-grok','PUT',{id,grokAccountId:b.id},session)).status,403);
assert.equal((await s.request('assign-grok','PUT',{id,grokAccountId:'missing'},admin)).status,400);
assert.equal((await s.request('assign-grok','PUT',{id,grokAccountId:b.id},admin)).status,200);
assert.equal((await (await s.request('me','GET',null,session)).json()).user,null);
login=await s.request('login','POST',{phone:'13900000008',password:'123456'});assert.equal((await login.json()).user.grokAccount,b.label);
assert.equal((await s.request('grok-accounts','PUT',{id:b.id,label:'备用账户',active:false},admin)).status,200);
assert.equal((await s.request('assign-grok','PUT',{id,grokAccountId:b.id},admin)).status,400);
assert.equal((await s.request('assign-grok','PUT',{id,grokAccountId:null},admin)).status,200);
login=await s.request('login','POST',{phone:'13900000008',password:'123456'});assert.equal((await login.json()).user.grokAccount,null);
assert.equal((await s.request('grok-accounts','PUT',{id:'missing',label:'不存在',active:true},admin)).status,404);
assert.equal((await s.request('grok-accounts','POST',{labels:['正常','']},admin)).status,400);
s.db.close();
});
