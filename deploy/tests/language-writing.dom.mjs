import assert from 'node:assert/strict';
import {Window} from '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js';
import {createLanguageWriting} from '../../public/studio/language-writing.mjs';
const dom=new Window({url:'https://studio.test'}),document=dom.document;
globalThis.window=dom;dom.confirm=()=>true;
document.body.innerHTML='<main></main><div id="modal" style="display:flex"><div id="modalBody"></div></div>';
const original='第1集\n△周宁打开窗户。\n第2集\n△周宁收起信。\n第3集\n△门外传来脚步声。\n';
let project={id:'80',title:'80集独立版本',script:original,settings:{writing:'保留卡点'}},user={id:'owner'},submitted=[],job=null,delay=null,submitDelay=null,flushDelay=null,saves=0,modalOpens=0,adoptions=0,adoptedRecords=[],redraws=[];
const accounts={current:()=>user,generationApi:async(action,body)=>{
 if(action==='status')return {online:true};
 if(action==='submit'){submitted.push(body);if(submitDelay)await submitDelay;job={id:'remote-1',status:'queued',result:'',error:''};return {job}}
 if(delay)await delay;return {job};
}};
const writing=createLanguageWriting({document,accounts,getProject:()=>project,change:(fn,redraw)=>{redraws.push(redraw);fn()},flush:async()=>{saves++;if(flushDelay)await flushDelay},openModal:html=>{modalOpens++;document.querySelector('#modalBody').innerHTML=html},toast:()=>{},onAdopt:record=>{adoptions++;adoptedRecords.push(record)}});
const tick=()=>new Promise(r=>setTimeout(r,20));
const click=async selector=>{document.querySelector(selector).click();await tick()};
await writing.open();await tick();assert.match(document.body.textContent,/剧本创作/);
assert.doesNotMatch(document.body.textContent,/复制并打开|ChatGPT|Grok|Mac mini/);
let prompt=document.querySelector('#writingPrompt').value;assert.match(prompt,/收起信/);assert.match(prompt,/脚步声/);assert.doesNotMatch(prompt,/打开窗户/);
assert.equal(submitted.length,0);await click('[data-writing="send"]');assert.equal(submitted.length,1);assert.equal(submitted[0].channel,'script');assert.equal(submitted[0].grokAccountId,undefined);assert.equal(project.script,original);
assert.equal(project.languageModelJobs[0].jobId,'remote-1');
job={id:'remote-1',status:'done',result:'第4集\n4-1 夜 内 仓库\n△周宁把信放在灯下，纸上浮现出一个熟悉的名字。\n周宁：他还活着。',error:''};
await click('[data-writing="refresh"]');assert.equal(project.languageModelJobs[0].result,job.result);assert.equal(project.script,original);assert.ok(saves>1);
project.script+='手工修改';await click('[data-writing="adopt"]');assert.match(document.querySelector('#writingError').textContent,/原稿已经变化/);assert.ok(project.script.endsWith('手工修改'));
project.script=original;await click('[data-writing="adopt"]');assert.match(project.script,/第4集/);assert.match(project.script,/打开窗户/);assert.ok(project.languageModelJobs[0].adoptedAt);
// A late network response must never save or render into a newly selected project.
await writing.open();await tick();await click('[data-writing="send"]');let release;delay=new Promise(r=>release=r);const pending=document.querySelector('[data-writing="refresh"]');pending.click();await tick();const old=project;project={id:'40',title:'40集',script:'独立原稿',settings:{}};release();await tick();assert.equal(project.script,'独立原稿');assert.equal(project.languageModelJobs,undefined);assert.equal(old.languageModelJobs.length,2);
// Embedded mode shares the same safeguards while keeping the containing workbench intact.
writing.close();delay=null;project={id:'inline',title:'统一作品',script:original,settings:{writing:'保留卡点'}};
document.querySelector('#modal').style.display='none';
document.querySelector('main').innerHTML='<p id="parentMarker">同一个作品工作台</p><section id="inlineHost"></section>';
const host=document.querySelector('#inlineHost'),opened=modalOpens,sent=submitted.length;
await writing.mount(host,{kind:'review',requirement:'只诊断节奏',partKey:'第2集#1'});await tick();
// Happy DOM's innerHTML parser misassigns selectedIndex; assert the emitted selection attributes.
assert.equal(modalOpens,opened);assert.equal(submitted.length,sent);assert.equal(host.querySelector('#writingKind option[selected]').value,'review');assert.equal(host.querySelector('#writingPart option[selected]').value,'第2集#1');assert.equal(host.querySelector('#writingRequirement').value,'只诊断节奏');assert.match(host.textContent,/剧本创作/);
host.querySelector('[data-writing="send"]').click();await tick();assert.equal(submitted.length,sent+1);assert.equal(project.languageModelJobs[0].kind,'review');assert.equal(project.languageModelJobs[0].sourceKey,'第2集#1');
job={id:'remote-1',status:'done',result:'节奏诊断：第二集结尾可增加具体行动线索。',error:''};
host.querySelector('[data-writing="refresh"]').click();await tick();assert.equal(project.languageModelJobs[0].result,job.result);assert.equal(document.querySelector('#parentMarker').textContent,'同一个作品工作台');assert.equal(project.script,original);
await writing.mount(host,{kind:'next'});await tick();host.querySelector('[data-writing="send"]').click();await tick();
job={id:'remote-1',status:'done',result:'第4集\n4-1 夜 内 仓库\n△周宁把信放在灯下，纸上浮现出一个熟悉的名字。\n周宁：他还活着。',error:''};
host.querySelector('[data-writing="refresh"]').click();await tick();const beforeAdopt=adoptions;host.querySelector('[data-writing="adopt"]').click();await tick();assert.equal(adoptions,beforeAdopt+1);assert.match(project.script,/第4集/);assert.equal(redraws.at(-1),false);assert.equal(document.querySelector('#parentMarker').textContent,'同一个作品工作台');
// A detached host and an invalidated session may not receive a late submit response.
await writing.mount(host);let resolveSubmit;submitDelay=new Promise(r=>resolveSubmit=r);host.querySelector('[data-writing="send"]').click();await tick();const pendingRecord=project.languageModelJobs.at(-1);assert.equal(pendingRecord.status,'submitting');host.remove();writing.unmount();resolveSubmit();await tick();assert.equal(pendingRecord.jobId,undefined);
const secondHost=document.createElement('section');document.querySelector('main').appendChild(secondHost);submitDelay=null;
await writing.mount(secondHost,{kind:'outline'});await tick();assert.equal(secondHost.querySelector('#writingKind option[selected]').value,'outline');assert.equal(secondHost.querySelector('[data-writing="send"]').disabled,false);
secondHost.querySelector(`[data-writing="retry"][data-id="${pendingRecord.requestId}"]`).click();await tick();assert.equal(submitted.at(-1).requestId,pendingRecord.requestId);assert.equal(pendingRecord.jobId,'remote-1');
// A completed save from the old project must not call the newly mounted workbench.
const candidate=project.languageModelJobs.find(j=>j.adoptedAt);project={id:'late-adopt',title:'延迟保存',script:original,settings:{},languageModelJobs:[{...candidate,projectId:'late-adopt',adoptedAt:null}]};
await writing.mount(secondHost);let releaseFlush;flushDelay=new Promise(r=>releaseFlush=r);const beforeLateAdopt=adoptions;secondHost.querySelector('[data-writing="adopt"]').click();await tick();const adoptedProject=project;assert.match(adoptedProject.script,/第4集/);
project={id:'fresh',title:'新作品',script:'第1集\n△保留新作品。',settings:{}};await writing.mount(secondHost,{kind:'review'});releaseFlush();flushDelay=null;await tick();assert.equal(adoptions,beforeLateAdopt);assert.equal(project.script,'第1集\n△保留新作品。');assert.equal(secondHost.querySelector('#writingKind option[selected]').value,'review');
// Outline and review results return to their own story fields without editing the script.
project={id:'reference',title:'创作资料回流',script:original,settings:{},story:{outline:'人工初始大纲',reviewReport:'已有诊断',characters:'保留人物设定'}};
await writing.mount(secondHost,{kind:'outline'});secondHost.querySelector('[data-writing="send"]').click();await tick();const outlineRecord=project.languageModelJobs.at(-1);assert.equal(outlineRecord.referenceSnapshot,'人工初始大纲');
job={id:'remote-1',status:'done',result:'故事大纲：周宁沿着信中的线索寻找失踪的父亲。',error:''};secondHost.querySelector('[data-writing="refresh"]').click();await tick();assert.equal(project.story.outline,'人工初始大纲');assert.equal(project.script,original);
const beforeOutline=adoptions;secondHost.querySelector(`[data-writing="reference"][data-id="${outlineRecord.requestId}"]`).click();await tick();assert.equal(project.story.outline,job.result);assert.equal(project.script,original);assert.equal(project.story.reviewReport,'已有诊断');assert.equal(project.story.characters,'保留人物设定');assert.equal(adoptions,beforeOutline+1);assert.equal(adoptedRecords.at(-1),outlineRecord);assert.equal(redraws.at(-1),false);assert.ok(outlineRecord.adoptedAt);assert.equal(secondHost.querySelector(`[data-writing="reference"][data-id="${outlineRecord.requestId}"]`).disabled,true);
await writing.mount(secondHost,{kind:'outline'});secondHost.querySelector('[data-writing="send"]').click();await tick();const staleOutline=project.languageModelJobs.at(-1);assert.equal(staleOutline.referenceSnapshot,project.story.outline);job={id:'remote-1',status:'done',result:'新的候选大纲：周宁决定离开小城。',error:''};secondHost.querySelector('[data-writing="refresh"]').click();await tick();project.story.outline='人工编辑后的大纲';const beforeStaleOutline=adoptions;
secondHost.querySelector(`[data-writing="reference"][data-id="${staleOutline.requestId}"]`).click();await tick();assert.match(secondHost.querySelector('#writingError').textContent,/创作资料已经变化/);assert.equal(project.story.outline,'人工编辑后的大纲');assert.equal(project.script,original);assert.equal(staleOutline.adoptedAt,undefined);assert.equal(adoptions,beforeStaleOutline);
await writing.mount(secondHost,{kind:'review'});secondHost.querySelector('[data-writing="send"]').click();await tick();const reviewRecord=project.languageModelJobs.at(-1);assert.equal(reviewRecord.referenceSnapshot,'已有诊断');job={id:'remote-1',status:'done',result:'质量诊断：保留前三集动作，第四集补足信件的来历。',error:''};secondHost.querySelector('[data-writing="refresh"]').click();await tick();assert.equal(project.story.reviewReport,'已有诊断');const beforeReview=adoptions;
secondHost.querySelector(`[data-writing="reference"][data-id="${reviewRecord.requestId}"]`).click();await tick();assert.equal(project.story.reviewReport,job.result);assert.equal(project.story.outline,'人工编辑后的大纲');assert.equal(project.script,original);assert.equal(adoptions,beforeReview+1);assert.equal(adoptedRecords.at(-1),reviewRecord);assert.equal(redraws.at(-1),false);assert.ok(reviewRecord.adoptedAt);assert.equal(document.querySelector('#parentMarker').textContent,'同一个作品工作台');
writing.close();user=null;const beforeGuest=submitted.length;await writing.mount(secondHost);assert.equal(submitted.length,beforeGuest);assert.match(secondHost.textContent,/请先登录/);assert.ok(secondHost.querySelector('[data-account="login"]'));
console.log('PASS modal and embedded generation, protected script adoption, outline/review reference adoption, stale reference rejection, detached hosts, guest state and parent DOM preservation');
await dom.happyDOM.abort();
