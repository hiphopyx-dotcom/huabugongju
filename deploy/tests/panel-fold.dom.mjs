import assert from 'node:assert/strict';
import {Window} from '/tmp/jbp-fold-dom/node_modules/happy-dom/lib/index.js';
const browser=new Window({url:'https://studio.local/test'});
const doc=browser.document;
Object.assign(globalThis,{document:doc,MutationObserver:browser.MutationObserver,localStorage:browser.localStorage});
const Fold=await import('../../pages/panel-fold.mjs');
let context={projectId:'project-A',page:'video'};
doc.body.innerHTML='<main id="main"></main><div id="modalBody"></div>';
Fold.install({context:()=>context});
const tick=()=>new Promise(r=>setTimeout(r,35));
function box(id){return doc.getElementById(id)}
function foldButton(el){return el.querySelector('.jbp-fold-bar > [data-jbp-fold-toggle]')}
function foldState(el){return el.dataset.jbpFoldState}
function page(text){box('main').innerHTML='<div class="page">'+text+'</div>';Fold.refresh()}
function switchTo(text,which='video'){context.page=which;page(text)}
function test(name,fn){return Promise.resolve().then(fn).then(()=>console.log('PASS '+name))}
await test('fold + expand never clears unsaved text or checkbox input',()=>{
 page('<section class="section" id="parameters"><h3>视频参数</h3><textarea id="prompt">原始文案</textarea><input type="checkbox" id="character" checked></section>'+
      '<section class="section" id="references"><h3>角色参考</h3><input id="characterName" value="周宁"></section>');
 const params=box('parameters'),input=box('prompt');
 input.value='手工调整、尚未持久化的分镜提示词';
 foldButton(params).click();assert.equal(foldState(params),'closed');
 assert.equal(input.value,'手工调整、尚未持久化的分镜提示词');
 assert.equal(box('character').checked,true);
 assert.equal(input.classList.contains('jbp-fold-content'),true);
 foldButton(params).click();assert.equal(foldState(params),'open');
 assert.equal(input.value,'手工调整、尚未持久化的分镜提示词');
 const toolbar=box('main').querySelector('[data-jbp-fold-global]');
 assert.ok(toolbar);
 toolbar.querySelector('[data-jbp-fold-all="close"]').click();
 assert.equal(foldState(params),'closed');
 toolbar.querySelector('[data-jbp-fold-all="open"]').click();
 assert.equal(foldState(params),'open');
});
await test('every project has independent remembered collapse state',()=>{
 switchTo('<section class="section" id="parameters"><h3>视频参数</h3><textarea>内容A</textarea></section>');
 const a=box('parameters');
 foldButton(a).click();assert.equal(foldState(a),'closed');
 context.projectId='project-B';switchTo('<section class="section" id="parameters"><h3>视频参数</h3><textarea>内容B</textarea></section>');
 const b=box('parameters');
 assert.equal(foldState(b),'open');
 context.projectId='project-A';switchTo('<section class="section" id="parameters"><h3>视频参数</h3><textarea>内容A</textarea></section>');
 assert.equal(foldState(box('parameters')),'closed');
});
await test('shot collapse follows stable ID when rows are reordered',()=>{
 const markup=(a,b)=>'<article class="shot" data-id="'+a+'"><div><h3>镜头 01</h3><textarea>A</textarea></div></article>'+
   '<article class="shot" data-id="'+b+'"><div><h3>镜头 02</h3><textarea>B</textarea></div></article>';
 switchTo(markup('shot-101','shot-202'),'shots');
 const a=doc.querySelector('[data-id="shot-101"]'),b=doc.querySelector('[data-id="shot-202"]');
 if(foldState(a)!=='closed')foldButton(a).click();
 if(foldState(b)!=='open')foldButton(b).click();
 assert.equal(foldState(a),'closed');assert.equal(foldState(b),'open');
 switchTo(markup('shot-202','shot-101'),'shots');
 assert.equal(foldState(doc.querySelector('[data-id="shot-101"]')),'closed');
 assert.equal(foldState(doc.querySelector('[data-id="shot-202"]')),'open');
});
await test('re-rendered inspector gets its accordion back with the previously selected state',()=>{
 context.page='canvas';box('main').innerHTML='<div class="workspace canvas-workspace"><div class="board"></div><section class="inspector" id="inspector"><h3>节点A属性</h3><input value="A"></section></div>';
 Fold.refresh();
 const node=box('inspector');assert.ok(foldButton(node));
 foldButton(node).click();assert.equal(foldState(node),'closed');
 node.innerHTML='<h3>节点B属性</h3><input id="newInspectorValue" value="B">';
 Fold.refresh();
 assert.ok(foldButton(node));
 assert.equal(foldState(node),'closed');
 assert.equal(box('newInspectorValue').value,'B');
});
await test('simple modal keeps its close button/title visible while collapsing fields and resets per modal',()=>{
 box('modalBody').innerHTML='<button class="modal-close">×</button><h2>视频参数</h2><label id="modalField">分辨率<select><option>720p</option></select></label><button>确定</button>';
 Fold.refresh();
 const m=box('modalBody');assert.ok(foldButton(m));
 foldButton(m).click();assert.equal(foldState(m),'closed');
 assert.equal(m.querySelector('.modal-close').classList.contains('jbp-fold-content'),false);
 assert.equal(m.querySelector('h2').classList.contains('jbp-fold-content'),false);
 assert.equal(box('modalField').classList.contains('jbp-fold-content'),true);
 box('modalBody').innerHTML='<button class="modal-close">×</button><h2>音频录制</h2><label id="recordField">声音来源<input></label><button>录制</button>';
 Fold.refresh();
 assert.ok(foldButton(m));assert.equal(foldState(m),'open');
});
await test('shot-guide options panel is foldable without destroying buttons',()=>{
 const overlay=doc.createElement('div');overlay.className='shot-guide-overlay';
 overlay.innerHTML='<section class="shot-guide-dialog"><div class="shot-guide-options" id="shotOptions"><button id="optionOne">固定镜头</button><button>推进镜头</button></div></section>';
 doc.body.append(overlay);Fold.refresh();
 const opt=box('shotOptions');assert.ok(foldButton(opt));
 foldButton(opt).click();assert.equal(foldState(opt),'closed');
 foldButton(opt).click();assert.equal(foldState(opt),'open');
 assert.ok(box('optionOne').isConnected);
 overlay.remove();
});
await test('dynamic unmarked controls in an existing collapsed panel are folded too',async()=>{
 context.page='video';page('<section class="section" id="dynamic"><h3>任务设置</h3><label>名称<input></label></section>');
 const target=box('dynamic');foldButton(target).click();assert.equal(foldState(target),'closed');
 const label=doc.createElement('label');label.id='lateControl';label.textContent='新选项';target.append(label);
 await tick();
 assert.equal(box('lateControl').classList.contains('jbp-fold-content'),true);
 assert.equal(foldState(target),'closed');
});
await test('account dialogs inserted without app modal helper still receive fold controls',async()=>{
 const target=box('modalBody');
 target.innerHTML='<button class="modal-close">×</button><h2>成员登录</h2><label id="phone">手机号<input></label><label id="password">密码<input type="password"></label><button>登录</button>';
 await tick();
 assert.ok(foldButton(target),'expected fold control on independently-rendered account dialog');
 foldButton(target).click();
 assert.equal(foldState(target),'closed');
 assert.ok(box('phone').isConnected);
 assert.equal(target.querySelector('.modal-close').classList.contains('jbp-fold-content'),false);
});
console.log('ALL DOM FOLD TESTS PASSED');
await browser.happyDOM.abort();
