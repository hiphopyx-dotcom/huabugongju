// No live model, account or billing calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createPianchangDesk} from '../public/studio/pianchang-desk.mjs';
import * as C from '../public/studio/core.mjs';
let dom;try{dom=await import('happy-dom')}catch{dom=await import(pathToFileURL('/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href)}
const {Window}=dom;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const script='第一集\n1-1 日 内 门房\n人物：阿青、小林\n道具：铜铃\n△阿青拿起铜铃。\n阿青：走。\n第二集\n2-1 夜 外 江边\n人物：小林\n△小林停下。';
const tick=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
const wait=async fn=>{for(let i=0;i<300;i++){await new Promise(r=>setTimeout(r,5));if(fn())return}throw Error('Fixture did not settle')};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(t,configure=()=>{}){
 const window=new Window({url:'http://localhost/studio/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}}),document=window.document;
 const previous={document:globalThis.document,FileReader:globalThis.FileReader,confirm:globalThis.confirm,DOMParser:globalThis.DOMParser};Object.assign(globalThis,{document,FileReader:window.FileReader,confirm:()=>true,DOMParser:window.DOMParser});document.body.innerHTML='<main id="host"></main>';
 const host=document.querySelector('#host'),state={user:{id:'member-a'},project:{...C.project(),script},calls:[],messages:[],saved:0,items:[],jobs:[],configured:true,sequence:0,workspace:{entities:[],style:'',portraitStyle:''}};configure(state);
 const uuid=()=>`00000000-0000-4000-8000-${String(++state.sequence).padStart(12,'0')}`;
 const request=async(action,body,params)=>{const c={action,body:body&&structuredClone(body),params,owner:state.user?.id,projectId:state.project.id};state.calls.push(c);const r=state.handler?.(c);if(r!==undefined)return await r;
  if(action==='status')return {configured:state.configured,rates:{image:2000},wallet:{available:50000},jobs:structuredClone(state.jobs)};
  if(action==='workspace')return {workspace:structuredClone(state.workspace),version:1};
  if(action==='slots')return {items:structuredClone(state.items)};
  if(action==='list')return {items:structuredClone(state.items.filter(i=>(!params.entityId||i.metadata.entityId===params.entityId)&&(!params.slot||i.metadata.slot===params.slot))),total:state.items.length};
  if(action==='delete'){state.items=state.items.filter(i=>i.id!==body.id);return {ok:true}}
  if(action==='import'||action==='generate'){const item={id:uuid(),name:body.name,kind:body.kind,prompt:body.prompt,projectId:body.projectId,metadata:body.metadata,created:Date.now(),width:1,height:1};state.items.push(item);return {item,job:{status:'done',requestId:body.requestId},wallet:{available:48000}}}
  throw Error('Unexpected action '+action);
 };
 let api;api=createPianchangDesk({getProject:()=>state.project,getUser:()=>state.user,change:fn=>fn(),save:async()=>{state.saved++},uid:uuid,toast:m=>state.messages.push(m),goto:page=>{state.page=page;if(['script','image','shots'].includes(page))api.mount(host,page)},request,fetchImage:async()=>({ok:true,blob:async()=>new window.Blob([Buffer.from(png.split(',')[1],'base64')],{type:'image/png'})})});
 api.mount(host,'script');t.after(async()=>{api.unmount();Object.assign(globalThis,previous);await window.happyDOM.abort()});
 const click=async s=>{const el=host.querySelector(s);assert.ok(el,s);el.click();await tick();return el};
 const change=(s,value)=>{const el=host.querySelector(s);assert.ok(el,s);el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}))};
 const input=(s,value)=>{const el=host.querySelector(s);assert.ok(el,s);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}))};
 return {api,state,host,document,window,click,change,input};
}
test('six-tab workflow splits selected episodes, displays original slots and remains valid',async t=>{
 const f=fixture(t);await tick();assert.equal(f.host.querySelectorAll('.pc-tabs [data-pc="tab"]').length,6);
 await f.click('[data-pc="parse"]');assert.equal(f.state.project.shots.length,2);assert.equal(f.state.project.script,script);
 await f.click('[data-pc="tab"][data-tab="characters"]');assert.equal(f.host.querySelectorAll('[data-pc="one"]').length,22);assert.match(f.host.textContent,/每张约 2,000/);
 await f.click('[data-pc="tab"][data-tab="locations"]');assert.equal(f.host.querySelectorAll('.pc-cross .pc-still').length,5);
 await f.click('[data-pc="tab"][data-tab="props"]');assert.equal(f.host.querySelectorAll('[data-pc="one"]').length,1);
 await f.click('[data-pc="tab"][data-tab="storyboard"]');assert.equal(f.host.querySelectorAll('.pc-beat').length,2);assert.ok(f.host.querySelector('[data-pc="guide"]'));
 f.change('[data-pc-field="episode"]','第二集');await f.click('[data-pc="tab"][data-tab="script"]');await f.click('[data-pc="parse"]');assert.equal(f.state.project.shots.length,3);assert.doesNotThrow(()=>C.validate(f.state.project));
});
test('untrusted script text and names never become markup',async t=>{
 const f=fixture(t,s=>{s.project.title='<img src=x onerror=alert(1)>';s.project.script='第一集\n1-1 日 内 门房\n△<img src=x onerror=alert(1)>。'});await tick();assert.equal(f.host.querySelectorAll('img').length,0);assert.equal(f.host.querySelector('.pc-title').textContent,'<img src=x onerror=alert(1)>');
 await f.click('[data-pc="parse"]');await f.click('[data-pc="tab"][data-tab="storyboard"]');assert.equal(f.host.querySelectorAll('img').length,0);assert.match(f.host.querySelector('[data-pc-beat][data-key="action"]').value,/<img/);
});
test('serial character batch keeps canonical references, quota request IDs and rejects double clicks',async t=>{
 const gate=deferred();let first=true;
 const f=fixture(t,s=>{s.handler=c=>{if(c.action==='generate'&&first){first=false;return gate.promise}}});await tick();await f.click('[data-pc="parse"]');await f.click('[data-pc="tab"][data-tab="characters"]');
 const id=f.state.project.pianchang.characters[0].id;const button=f.host.querySelector(`[data-pc="batch-one"][data-id="${id}"]`);button.click();button.click();await tick();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);assert.ok(f.state.saved>0);
 const c=f.state.calls.find(c=>c.action==='generate');assert.equal(c.body.projectId,f.state.project.id);assert.equal(c.owner,'member-a');assert.equal(c.body.metadata.slot,'front');assert.equal(c.body.ratio,'3:4');assert.equal(c.body.provider,undefined);assert.equal(c.body.grokAccountId,undefined);
 const item={id:'front-canonical',name:'正面',kind:'角色',projectId:f.state.project.id,metadata:c.body.metadata,prompt:c.body.prompt};f.state.items.push(item);gate.resolve({job:{status:'done'},item});
 try{await wait(()=>f.state.calls.filter(c=>c.action==='generate').length===11&&!f.host.querySelector('.pc-queue'))}catch(e){throw Error(e.message+' '+JSON.stringify({messages:f.state.messages,calls:f.state.calls.filter(c=>c.action==='generate').length,pending:f.state.project.pianchang.pending}))}
 const calls=f.state.calls.filter(c=>c.action==='generate');assert.equal(new Set(calls.map(c=>c.body.requestId)).size,11);assert.deepEqual(calls[1].body.references,[{id:'front-canonical'}]);assert.equal(f.state.project.assets.length,11);assert.equal(Object.keys(f.state.project.pianchang.pending).length,0);assert.doesNotThrow(()=>C.validate(f.state.project));
});
test('unknown result stays pending across remount and prevents another charge',async t=>{
 const f=fixture(t,s=>{s.handler=c=>{if(c.action==='generate')throw Error('connection interrupted')}});await tick();await f.click('[data-pc="parse"]');await f.click('[data-pc="tab"][data-tab="characters"]');await f.click('[data-pc="one"]');
 assert.equal(Object.keys(f.state.project.pianchang.pending).length,1);f.api.mount(f.host,'image');await tick();assert.match(f.host.textContent,/待核对/);await f.click('[data-pc="batch-characters"]');assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);
});
test('late generation cannot cross accounts or projects; leaving stops subsequent jobs',async t=>{
 for(const mode of ['project','account','navigate'])await t.test(mode,async t=>{
 const gate=deferred();const f=fixture(t,s=>{s.handler=c=>c.action==='generate'?gate.promise:undefined});await tick();await f.click('[data-pc="parse"]');await f.click('[data-pc="tab"][data-tab="characters"]');await f.click('[data-pc="batch-characters"]');const old=f.state.project;
 if(mode==='project')f.state.project={...C.project(),title:'新项目',script:''};if(mode==='account')f.state.user={id:'member-b'};f.api.mount(f.host,mode==='navigate'?'script':'image');await tick();
 gate.resolve({job:{status:'done'},item:{id:'secret-image',name:'旧图',metadata:{entityId:old.pianchang.characters[0].id,slot:'front'}}});await tick();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);assert.equal(f.state.project.assets.length,0);assert.doesNotMatch(f.host.innerHTML,/secret-image/);
 });
});
test('file import captures the original account/project before reading',async t=>{
 const f=fixture(t);await tick();const gate=deferred();const field=f.host.querySelector('[data-pc-file]');Object.defineProperty(field,'files',{value:[{name:'剧本.txt',size:100,arrayBuffer:()=>gate.promise}]});field.dispatchEvent(new f.window.Event('change',{bubbles:true}));
 f.state.project={...C.project(),script:'新项目原文'};f.api.mount(f.host,'script');gate.resolve(new TextEncoder().encode('旧剧本').buffer);await tick();assert.equal(f.state.project.script,'新项目原文');
});
test('legacy cloud workspace and image slots stay visible in the new desk',async t=>{
 const f=fixture(t,s=>{s.project.script='';s.workspace={entities:[{id:'legacy-a',category:'characters',name:'旧人物',scope:'episode',episode:'第一集',fields:{costume:'旧青衫'}}]};s.items=[{id:'legacy-photo',name:'旧图',kind:'角色',metadata:{entityId:'legacy-a',slot:'front'}}]});await tick();await f.click('[data-pc="tab"][data-tab="characters"]');assert.equal(f.host.querySelector('[data-pc-entity="characters"][data-key="name"]').value,'旧人物');assert.match(f.host.innerHTML,/legacy-photo/);assert.equal(f.state.project.pianchang.characters[0].costume,'旧青衫');
});

test('episode editor explicitly saves/restores drafts, retains them on remount, and full-script paste splits episodes',async t=>{
 const f=fixture(t);await tick();assert.ok(!f.host.querySelector('[data-pc-field="script"]').value.includes('第二集'));
 f.input('[data-pc-field="script"]','第一集\n1-1 日 内 门房\n△阿青跑。\n');assert.equal(f.state.project.script,script);assert.equal(f.host.querySelector('[data-pc="script-save"]').disabled,false);
 f.api.mount(f.host,'script');await tick();assert.match(f.host.querySelector('[data-pc-field="script"]').value,/阿青跑/);await f.click('[data-pc="script-restore"]');assert.match(f.host.querySelector('[data-pc-field="script"]').value,/阿青拿起/);
 f.input('[data-pc-field="script"]','第一集\n1-1 日 内 门房\n△阿青跑。\n');await f.click('[data-pc="script-save"]');assert.match(f.state.project.script,/阿青跑/);assert.ok(f.state.project.script.endsWith(script.slice(script.indexOf('第二集'))));
 await f.click('[data-pc="script-mode"]');f.input('[data-pc-field="script"]',script);await f.click('[data-pc="parse"]');assert.equal(f.state.project.script,script);assert.equal(f.state.project.shots.length,2);
});
test('OTS pose and position controls persist to canonical shot and image versions remain immutable',async t=>{
 const f=fixture(t);await tick();await f.click('[data-pc="parse"]');await f.click('[data-pc="tab"][data-tab="storyboard"]');const id=f.state.project.shots[0].id;
 f.change(`[data-pc-entity="beats"][data-id="${id}"][data-key="composition"]`,'过肩镜头');await f.click(`[data-pc="pose"][data-id="${id}"][data-who="a"][data-pose="kneel"]`);f.change(`[data-pc-axis-position="b"][data-beat="${id}"]`,'88');assert.equal(JSON.parse(f.state.project.shots[0].otsBlock).a.pose,'kneel');assert.equal(JSON.parse(f.state.project.shots[0].otsBlock).b.along,88);
 for(const c of f.state.project.pianchang.characters){f.state.project.pianchang.stills[c.id+':front']=png;}await f.click('[data-pc="one"]');await wait(()=>!f.host.querySelector('.pc-queue'));assert.equal(f.state.project.assets.length,1);const old=f.state.project.shots[0].assetId;
 await f.click('[data-pc="slot"]');f.input('[data-pc-edit]','只改背景为蓝色');await f.click('[data-pc="edit-image"]');await wait(()=>!f.host.querySelector('.pc-queue'));assert.equal(f.state.project.assets.length,2);assert.notEqual(f.state.project.shots[0].assetId,old);assert.ok(f.state.project.assets.some(a=>a.id===old));
});
