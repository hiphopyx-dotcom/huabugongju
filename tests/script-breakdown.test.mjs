import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import * as B from '../public/studio/script-breakdown.mjs';
import * as C from '../public/studio/core.mjs';

const script='第一集\n1-1 日 内 客厅\n人物：小林、小陈\n△小林拿起钥匙。\n小林：我回来了。\n1-2 夜 外 院子\n小陈：等一下！\n△小陈推开门。';
const batch=B.batches(script)[0];
const answer=()=>({shots:[{sourceLines:[4,5],description:'小林拿起钥匙，说话。',dialogue:'小林：我回来了。',duration:5,size:'中景',angle:'眼睛平视',camera:'固定镜头',characterNames:['小林'],propNames:['钥匙'],continuity:'维持服装与视线方向'}]});
function zip(xml,method=8){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),data=method===8?deflateRawSync(raw):raw,local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(method,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(method,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);const offset=local.length+name.length+data.length;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(offset,16);const b=Buffer.concat([local,name,data,central,name,end]);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length)}
test('导入 UTF8、UTF16、GBK 中文，拒绝空文及超限',()=>{assert.equal(B.decodeText(new TextEncoder().encode('\uFEFF第一集\r\n△开门。')),'第一集\n△开门。');assert.equal(B.decodeText(Uint8Array.from([255,254,45,78,135,101])),'中文');assert.equal(B.decodeText(Uint8Array.from([0xd6,0xd0,0xce,0xc4])),'中文');assert.throws(()=>B.cleanText('  '),/没有/);assert.throws(()=>B.cleanText('字'.repeat(300001)),/30万/)});
test('读取压缩和未压缩 DOCX 正文，拒绝截断、加密和超大正文',async()=>{for(const method of [0,8])assert.equal(await B.docxXML(zip('<w:document>中文</w:document>',method)),'<w:document>中文</w:document>');await assert.rejects(B.docxXML(new ArrayBuffer(10)),/有效/);const encrypted=zip('正文');const e=new DataView(encrypted),end=encrypted.byteLength-22,at=e.getUint32(end+16,true);e.setUint16(at+8,1,true);await assert.rejects(B.docxXML(encrypted),/加密/);const big=zip('正文'),v=new DataView(big);v.setUint32(v.getUint32(big.byteLength-6,true)+24,6000001,true);await assert.rejects(B.docxXML(big),/过大/)});
test('导入不把 PDF 和二进制 DOC 当成乱码文本，不执行 XML 实体',async()=>{await assert.rejects(B.readScript({name:'剧本.pdf',size:30}),/另存/);await assert.rejects(B.readScript({name:'剧本.doc',size:30,arrayBuffer:async()=>new ArrayBuffer(30)}),/另存/);assert.throws(()=>B.textFromXML('<!DOCTYPE foo>'),/文档声明/);await assert.rejects(B.readScript({size:21*1024*1024,name:'x.txt'}),/20MB/)});
test('分批保持分场和原始行号；长剧本逐批提交且不遗漏内容',()=>{const chunks=B.batches(script);assert.equal(chunks.length,2);assert.deepEqual(chunks.map(p=>p.lines.map(l=>l.n)),[[4,5],[7,8]]);assert.match(chunks[1].label,/1-2/);const long=Array.from({length:120},(_,i)=>`△小林走了${i}步。`).join('\n'),parts=B.batches(long);assert.equal(parts.flatMap(p=>p.lines).length,120);assert.ok(parts.every(p=>B.promptFor(p).length<=8000));assert.throws(()=>B.batches('△'+'字'.repeat(4001)),/换行/)});
test('剧名、原著和简介不算镜头，从第一场场头才开始',()=>{
 const front='剧名：铜铃\n原著：张三长篇小说\n类型：都市情感\n简介：一个关于回归的故事，写了很久。\n人物小传：小林，二十五岁。\n第一集\n本集看点：他推门进来。\n1-1 日 内 客厅\n人物：小林\n△小林拿起钥匙。\n小林：我回来了。\n第二集\n原著摘录：很多年以前。\n2-1 夜 外 院子\n△小陈推开门。';
 const shots=C.parseScript(front);
 assert.deepEqual(shots.map(s=>s.description),['小林拿起钥匙。','小陈推开门。']);
 assert.deepEqual(shots.map(s=>s.scene),['1-1 日 内 客厅','2-1 夜 外 院子']);
 assert.equal(shots[0].episode,'第一集');
 assert.equal(shots[1].episode,'第二集');
 assert.ok(shots.every(s=>!/剧名|原著|简介|小传|看点|摘录/.test(s.sourceText+s.description)));
 const parts=B.batches(front);
 assert.deepEqual(parts.map(p=>p.lines.map(l=>l.text)),[['△小林拿起钥匙。','小林：我回来了。'],['△小陈推开门。']]);
});
test('没有场头的纯正文仍逐行拆镜',()=>{assert.equal(C.parseScript('小林推开门。\n小陈转头。').length,2)});
test('本地拆分不会把新场台词混入上一场；普通动作逐行成镜',()=>{const shots=C.parseScript(script);assert.equal(shots.length,3);assert.equal(shots[0].dialogue,'小林：我回来了。');assert.equal(shots[1].scene,'1-2 夜 外 院子');assert.equal(shots[1].dialogue,'小陈：等一下！');assert.equal(shots[1].sourceLines[0],7);assert.ok(shots.every(s=>s.breakdownMethod==='local'));assert.deepEqual(C.parseScript('第2集\n场景：厨房\n小林：来了！')[0].characterNames,['小林'])});
test('模型结果生成可追溯原文，忽略外部ID和媒体注入',()=>{const raw=answer();raw.shots[0].id='foreign';raw.shots[0].assetId='victim';raw.shots[0].src='javascript:bad';const shots=B.parseResult('```json\n'+JSON.stringify(raw)+'\n```',batch);assert.equal(shots[0].sourceText,'△小林拿起钥匙。\n小林：我回来了。');assert.equal(shots[0].assetId,'');assert.equal(shots[0].src,undefined);assert.equal(shots[0].id,undefined);assert.equal(shots[0].propNames[0],'钥匙')});
test('模型漏行、乱序、跨场、伪造台词、无效镜长不会进入镜头表',()=>{for(const mutate of [r=>r.shots[0].sourceLines=[4],r=>r.shots[0].sourceLines=[5,4],r=>r.shots[0].sourceLines=[4,7],r=>r.shots[0].dialogue='小林：我杀了他。',r=>r.shots[0].duration=999,r=>r.shots[0].characterNames=['陌生人']]){const r=answer();mutate(r);assert.throws(()=>B.parseResult(JSON.stringify(r),batch))}assert.throws(()=>B.parseResult('{"shots":[',batch),/完整JSON/)});
test('引用只绑定本项目同类型同名图片，每次建立新镜头ID',()=>{const shots=B.parseResult(JSON.stringify(answer()),batch),bound=B.bindReferences(shots,[{id:'a',name:'小林',kind:'image',type:'角色'},{id:'b',name:'小林',kind:'video',type:'角色'},{id:'c',name:'钥匙',kind:'image',type:'道具'}]);assert.deepEqual(bound[0].characters,['a']);assert.deepEqual(bound[0].props,['c']);assert.ok(bound[0].id);assert.notEqual(B.bindReferences(shots,[])[0].id,bound[0].id)});

function harness(role='user',request=async()=>({online:true})){
 let project=C.project(),user={id:'member',role},listener,html='',messages=[];project.script=script;
 const values=new Map(),doc={addEventListener(_,fn){listener=fn},querySelector(key){if(!values.has(key))values.set(key,{value:'',style:{display:'flex'}});return values.get(key)}};
 const controller=B.create({document:doc,getProject:()=>project,getUser:()=>user,request,change:fn=>fn(),openModal:s=>{html=s;for(const m of s.matchAll(/id="([^"]+)"/g))doc.querySelector("#"+m[1])},close:()=>{html=''},toast:s=>messages.push(s),onShots(){}});
 return {controller,project,values,get html(){return html},messages,switchUser:()=>{user={id:user.id+'-next',role}},switchProject:()=>{project=C.project()},click:async action=>{const button={dataset:{breakdown:action},disabled:false};await listener({target:{closest:()=>button}})}};
}
test('AI 拆镜成员提交不包含后台账号；管理员必须明确选账号',async()=>{
 const calls=[],h=harness('user',async(action,body)=>{calls.push([action,body]);if(action==='status')return {online:true};if(action==='submit')return {job:{id:'job1',status:'failed',error:'fixture failure'}};return {job:{status:'failed',error:'fixture failure'}}});await h.controller.aiSetup();h.values.get('#breakdownPart').value='0';await h.click('submit');assert.equal(calls[1][1].grokAccountId,undefined);assert.match(calls[1][1].prompt,/sourceLines/);assert.equal(h.project.scriptBreakdown.owner,'member');
 const admin=harness('admin',async()=>({workers:[{id:'backend-2',label:'指定账号',active:true,online:true}]}));await admin.controller.aiSetup();admin.values.get('#breakdownPart').value='0';await admin.click('submit');assert.match(admin.messages.at(-1),/请选择已连接/);
});
test('预览期间修改剧本阻止覆盖；确认后只能应用一次',async()=>{const h=harness();h.controller.local();h.project.script+='\n△结束。';await h.click('replace');assert.equal(h.project.shots.length,0);assert.match(h.messages.at(-1),/重新核对/);h.controller.local();await h.click('append');const count=h.project.shots.length;assert.ok(count>0);await h.click('append');assert.equal(h.project.shots.length,count)});
test('账号切换后，不回填旧账号异步结果，也不允许导入旧弹窗',async()=>{let resolve;const h=harness('user',()=>new Promise(r=>resolve=r));const loading=h.controller.aiSetup();h.switchUser();resolve({online:true});await loading;assert.equal(h.html,'');h.controller.importDialog();h.values.set('#breakdownInput',{value:script});h.switchUser();await h.click('import');assert.match(h.messages.at(-1),/账号已切换/)});
test('网络断开后重试使用已保存的 requestId，不创建第二份付费任务',async()=>{const ids=[];let submit=0;const h=harness('user',async(action,body)=>{if(action==='status')return {online:true};if(action==='submit'){ids.push(body.requestId);if(++submit===1)throw Error('network');return {job:{id:'safe-job',status:'failed'}}}return {job:{status:'failed',error:'fixture'}}});await h.controller.aiSetup();h.values.get('#breakdownPart').value='0';await h.click('submit');assert.equal(h.project.scriptBreakdown.status,'submitting');await h.click('job');assert.equal(ids.length,2);assert.equal(ids[0],ids[1])});
