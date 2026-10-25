import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {hash} from '../lib/security.mjs';
import {createQuotaHandler,createQuotaService} from '../lib/quota.mjs';
import {estimateText,estimateMedia,TEXT_OUTPUT_HOLD} from '../../public/studio/token-estimate.mjs';
test('文字及媒体估算涵盖中文、英文、时长、批次与64KB输出上界',()=>{
 assert.equal(estimateText('你好'),2);assert.equal(estimateText('abcd'),1);
 assert.equal(estimateMedia('image',{count:3},{image:2000,videoSecond:1000}),6000);
 assert.equal(estimateMedia('video',{count:2,seconds:5.5},{image:2000,videoSecond:1000}),11000);
 for(const s of ['a'.repeat(65536),'é'.repeat(32768),'中'.repeat(21845),'😀'.repeat(16384)])assert.ok(estimateText(s)<=TEXT_OUTPUT_HOLD);
 for(const options of [{count:0},{count:21},{count:1.2},{seconds:0},{seconds:601}])assert.throws(()=>estimateMedia('video',options));
});
function setup(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const now=Date.now();for(const [id,role,phone] of [['admin','admin','1234567'],['member','user','2345678'],['other','user','3456789']]){db.prepare('INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES(?,?,?,?,?,?)').run(id,phone,id,'unused',role,now);db.prepare('INSERT INTO studio_sessions VALUES(?,?,?,?)').run(hash(id),id,1,now+60000)}
 const calls=[];const query=async(sql,params)=>{calls.push(sql);const statement=db.prepare(sql.replace(/\$\d+/g,'?'));params=params.map(p=>typeof p==='boolean'?Number(p):p);return /^(SELECT|WITH)/.test(sql)?statement.all(...params):statement.run(...params)&&[]};
 const handler=createQuotaHandler(query,{now:()=>now});return {db,calls,request:(action,body,user='member',origin='https://example.test')=>handler(new Request('https://example.test/api/quota?action='+action,{method:body===undefined?'GET':'POST',headers:{cookie:'__Host-jbp-session='+user,origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}))};}
test('额度接口认证、越权、来源校验：成员无法改余额、系数、结算或读取他人',async()=>{const s=setup();try{
 assert.equal((await s.request('status',undefined,'missing')).status,401);
 assert.equal((await s.request('status&owner=other')).status,403);
 assert.equal((await s.request('users')).status,403);
 for(const action of ['limit','rates','charge','release'])assert.equal((await s.request(action,{})).status,403);
 assert.equal((await s.request('reserve',{},'member','https://evil.test')).status,403);
 assert.equal((await s.request('reserve',{owner:'other'})).status,403);
 assert.equal((await s.request('reserve',{requestId:'text:fake',kind:'image',count:1})).status,400);
 assert.equal((await s.request('reserve',{requestId:'media:x',kind:'video',count:1,seconds:-1})).status,400);
 assert.equal((await s.request('rates',{image:0,videoSecond:1},'admin')).status,400);
 assert.equal((await s.request('charge',{requestId:'text:fake'},'admin')).status,400);
 assert.ok(!s.calls.some(sql=>sql.includes('studio_quota_change')));
 }finally{s.db.close()}});
test('文字提交使用单个原子调用、按账号隔离，并将输入和最大输出一同预占',async()=>{const calls=[],service=createQuotaService(async(sql,params)=>{calls.push([sql,params]);return []});await service.submitText({id:'job',user:{id:'member',session_version:2},account:'assigned',requestId:'request',prompt:'中文',now:1});const [sql,args]=calls.at(-1);assert.ok(sql.startsWith('SELECT studio_quota_text_submit('));assert.deepEqual(args,['job','member','assigned',2,'request','中文',TEXT_OUTPUT_HOLD+2,1]);});
