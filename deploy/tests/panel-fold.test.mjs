import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {panelName,keyFor,decideState} from '../../pages/panel-fold.mjs';

function panel({title='',classes=['section'],before=null}={}){
 const c=new Set(classes);
 return {
   querySelector:()=>title?{textContent:title}:null,
   matches:sel=>sel.split(',').some(x=>[...c].some(cls=>x.includes(cls))),
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
test('fold actions only change visibility, never delete or overwrite project data',()=>{
 const src=fs.readFileSync(new URL('../../pages/panel-fold.mjs',import.meta.url),'utf8');
 assert.ok(src.includes("child.classList.add('jbp-fold-content')"));
 assert.ok(src.includes('dataset.jbpFoldState'));
 assert.ok(src.includes('MutationObserver'));
 for(const forbidden of ['removeChild(', 'replaceChildren(', 'indexedDB.deleteDatabase'])assert.ok(!src.includes(forbidden),forbidden);
});

test('workbench page and modal render paths install fold enhancement with CSS-only hiding',()=>{
 const app=fs.readFileSync(new URL('../../pages/app.mjs',import.meta.url),'utf8');
 const css=fs.readFileSync(new URL('../../pages/style.css',import.meta.url),'utf8');
 const accounts=fs.readFileSync(new URL('../../pages/accounts.mjs',import.meta.url),'utf8');
 for(const fragment of ["import * as Fold from './panel-fold.mjs", 'Fold.install(', 'Fold.refresh()'])assert.ok(app.includes(fragment),fragment);
 assert.ok(css.includes('[data-jbp-fold-state="closed"]>.jbp-fold-content'));
 assert.ok(css.includes('.jbp-fold-detail-hidden'));
 assert.ok(css.includes('.jbp-fold-global'));
 assert.ok(accounts.includes('<h3>嵌入的图片工坊</h3>'));
});
