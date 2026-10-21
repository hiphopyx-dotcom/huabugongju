import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {panelName,keyFor,decideState} from '../../pages/panel-fold.mjs';

function panel({title='',classes=['section'],before=null}={}){
 const c=new Set(classes);
 return {
   querySelector:()=>title?{textContent:title}:null,
   classList:{contains:x=>c.has(x)},
   previousElementSibling:before
 };
}
test('stable fold keys are isolated between projects, pages, dialogs and same-title regions',()=>{
 const a=keyFor({projectId:'project-1',page:'video',scope:'main',name:'镜头',position:2});
 assert.equal(a,keyFor({projectId:'project-1',page:'video',scope:'main',name:'镜头',position:2}));
 assert.notEqual(a,keyFor({projectId:'project-2',page:'video',scope:'main',name:'镜头',position:2}));
 assert.notEqual(a,keyFor({projectId:'project-1',page:'shots',scope:'main',name:'镜头',position:2}));
 assert.notEqual(a,keyFor({projectId:'project-1',page:'video',scope:'modal',name:'镜头',position:2}));
 assert.notEqual(a,keyFor({projectId:'project-1',page:'video',scope:'main',name:'镜头',position:3}));
 assert.ok(a.startsWith('jbp-panels-v2:'));
});
test('user choices beat defaults; corrupt values fall back without throwing',()=>{
 assert.equal(decideState('closed',false),'closed');
 assert.equal(decideState('open',true),'open');
 assert.equal(decideState(null,true),'closed');
 assert.equal(decideState(undefined,false),'open');
 assert.equal(decideState('garbage',true),'closed');
});
test('section title uses visible heading and concise fallback, without storing user content',()=>{
 assert.equal(panelName(panel({title:'  按人物  一致性设定 ',classes:['section']})),'按人物 一致性设定');
 assert.equal(panelName(panel({classes:['video-sequence']})),'多镜头编排');
 assert.equal(panelName(panel({classes:['inspector']})),'节点属性');
 assert.equal(panelName(panel({classes:['shot']})),'分镜详情');
 assert.equal(panelName(panel({classes:['vs-controls']})),'虚拟片场操作');
});
test('UI code changes no source project schemas and contains a non-destructive visibility implementation',()=>{
 const src=fs.readFileSync(new URL('../../pages/panel-fold.mjs',import.meta.url),'utf8');
 assert.match(src, /\\.classList\\.add\\('jbp-fold-content'\\)/);
 assert.match(src, /dataset\\.jbpFoldState/);
 assert.match(src, /MutationObserver/);
 assert.doesNotMatch(src,/\\.removeChild\\(|\\.replaceChildren\\(|indexedDB\\.deleteDatabase/);
});
