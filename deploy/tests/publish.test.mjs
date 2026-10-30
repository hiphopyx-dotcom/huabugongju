import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createAccountHandler} from '../lib/accounts.mjs';
import {createCollaborationHandler} from '../lib/collaboration.mjs';
import {createPublishHandler} from '../lib/publish.mjs';
import {project} from '../../public/studio/core.mjs';
import {shared} from '../../public/studio/collab-core.mjs';
import {exportJingbenPack, charPackPath} from '../../public/studio/jingben-pack.mjs';
import {projectsFromJingben} from '../../pages/jingben-bridge.mjs';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/fenjing-port.sql'));
  db.exec('CREATE TABLE studio_images (id text, owner text, project_id text, project_title text, name text, asset_kind text, created bigint)');
  const query=async(sql,p)=>db.prepare(sql).all(Object.fromEntries(p.map((v,i)=>['$'+(i+1),typeof v==='boolean'?Number(v):v])));
  const accounts=createAccountHandler(query,{setupToken:'test-setup-secret-with-32-characters'});
  const collab=createCollaborationHandler(query);
  const publish=createPublishHandler(query);
  const call=(handler,path,method,data,cookie)=>handler(new Request('https://studio.test'+path,{method,headers:{Origin:'https://studio.test','Content-Type':'application/json',Cookie:cookie||''},body:data?JSON.stringify(data):undefined}));
  return {db,call,accounts,collab,publish};
}
async function adminOf(s){
  let r=await s.call(s.accounts,'/api/accounts?action=bootstrap','POST',{setupToken:'test-setup-secret-with-32-characters',phone:'13800000000',password:'administrator-password',name:'管理员'});
  assert.equal(r.status,201);
  r=await s.call(s.accounts,'/api/accounts?action=login','POST',{phone:'13800000000',password:'administrator-password'});
  return r.headers.get('set-cookie').split(';')[0];
}

test('公开一部剧后游客能看到，收回后看不到',async()=>{
  const s=setup(), admin=await adminOf(s);
  const made=await s.call(s.publish,'/api/publish?action=set-project','POST',{subjectId:'play-1',title:'夜渡',payload:{title:'夜渡'},public:true},admin);
  assert.equal(made.status,200);
  const id=(await made.json()).id;
  const open=await s.call(s.publish,'/api/publish?action=get&id='+id,'GET');
  assert.equal((await open.json()).item.title,'夜渡');
  await s.call(s.publish,'/api/publish?action=set-project','POST',{subjectId:'play-1',title:'夜渡',public:false},admin);
  assert.equal((await s.call(s.publish,'/api/publish?action=get&id='+id,'GET')).status,404);
  s.db.close();
});

test('二级管理员能看成员的图，不能开通成员',async()=>{
  const s=setup(), admin=await adminOf(s);
  const created=await s.call(s.accounts,'/api/accounts?action=users','POST',{name:'成员',phone:'13900000000',password:'123456'},admin);
  assert.equal(created.status,201);
  const users=await (await s.call(s.accounts,'/api/accounts?action=users','GET',null,admin)).json();
  const member=users.users.find(u=>u.phone==='13900000000');
  assert.equal((await s.call(s.accounts,'/api/accounts?action=grant','POST',{userId:member.id,grant:'sub-admin'},admin)).status,200);
  s.db.prepare('INSERT INTO studio_images VALUES (?,?,?,?,?,?,?)').run('img1',member.id,'p','夜渡','正面','角色',1);
  const login=await s.call(s.accounts,'/api/accounts?action=login','POST',{phone:'13900000000',password:'123456'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const work=await s.call(s.accounts,'/api/accounts?action=member-work&owner='+member.id,'GET',null,cookie);
  assert.equal(work.status,200);
  assert.equal((await work.json()).images[0].name,'正面');
  assert.equal((await s.call(s.accounts,'/api/accounts?action=users','POST',{name:'别人',phone:'13900000001',password:'123456'},cookie)).status,403);
  s.db.close();
});

test('申请加入同意后出现在一起做的剧',async()=>{
  const s=setup(), admin=await adminOf(s);
  await s.call(s.accounts,'/api/accounts?action=users','POST',{name:'乙',phone:'13900000002',password:'123456'},admin);
  const room=await (await s.call(s.collab,'/api/collaboration?action=rooms','POST',{document:shared(project('夜渡'))},admin)).json();
  const login=await s.call(s.accounts,'/api/accounts?action=login','POST',{phone:'13900000002',password:'123456'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await s.call(s.collab,'/api/collaboration?action=apply','POST',{room:room.id},cookie)).status,200);
  const pending=await (await s.call(s.collab,'/api/collaboration?action=applications','GET',null,admin)).json();
  assert.equal(pending.requests.length,1);
  assert.equal((await s.call(s.collab,'/api/collaboration?action=approve','POST',{requestId:pending.requests[0].id},admin)).status,200);
  const listed=await (await s.call(s.collab,'/api/collaboration?action=shared-list','GET',null,cookie)).json();
  assert.equal(listed.rooms.some(r=>r.id===room.id),true);
  s.db.close();
});

test('片场包能被现有导入读回，人物包文件名带目录',()=>{
  const p=project('夜渡');
  p.pianchang={beats:[{id:'b1',episode:'第一集',scene_heading:'1-1',action:'推门',shot_size:'特写'}],characters:[{id:'c1',episode:'第一集',name:'凯恩',costume:'黑外套'}],locations:[],props:[],images:{'c1:front':{id:'img',prompt:'正面'}},stills:{'c1:front':'data:image/jpeg;base64,aa'}};
  const pack=exportJingbenPack(p,1);
  const made=projectsFromJingben(pack,()=>'new');
  assert.equal(made[0].title,'夜渡');
  assert.match(JSON.stringify(made[0]),/凯恩/);
  assert.equal(charPackPath('凯恩','正面'),'凯恩/凯恩-正面.jpg');
});
