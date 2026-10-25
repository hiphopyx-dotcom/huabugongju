import assert from 'node:assert/strict';
import {Window} from '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js';
import {createLanguageWriting} from '../../pages/language-writing.mjs';
const dom=new Window({url:'https://studio.test'}),document=dom.document;
globalThis.window=dom;dom.confirm=()=>true;
document.body.innerHTML='<main></main><div id="modal" style="display:flex"><div id="modalBody"></div></div>';
const original='第1集\n△周宁打开窗户。\n第2集\n△周宁收起信。\n第3集\n△门外传来脚步声。\n';
let project={id:'80',title:'80集独立版本',script:original,settings:{writing:'保留卡点'}},user={id:'owner'},submitted=[],job=null,delay=null,saves=0;
const accounts={current:()=>user,generationApi:async(action,body)=>{
 if(action==='status')return {online:true};
 if(action==='submit'){submitted.push(body);job={id:'remote-1',status:'queued',result:'',error:''};return {job}}
 if(delay)await delay;return {job};
}};
const writing=createLanguageWriting({document,accounts,getProject:()=>project,change:fn=>fn(),flush:async()=>{saves++},openModal:html=>document.querySelector('#modalBody').innerHTML=html,toast:()=>{}});
const tick=()=>new Promise(r=>setTimeout(r,20));
const click=async selector=>{document.querySelector(selector).click();await tick()};
await writing.open();await tick();assert.match(document.body.textContent,/语言模型写剧本/);
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
console.log('PASS direct send, server-only route, automatic result, persisted candidate, guarded adoption, late response/project switch');
await dom.happyDOM.abort();
