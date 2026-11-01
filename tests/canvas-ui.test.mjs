import test from 'node:test';
import assert from 'node:assert/strict';
import {card,inspector} from '../public/studio/canvas-ui.mjs';

const fakeAsset=(id)=>id==='reference' ? {id,name:'角色A',kind:'image',src:'data:image/png;base64,AAAA'} : null;
const ctx={asset:fakeAsset,selected:'a',linkFrom:null,mediaHTML:a=>'<img alt="参考素材" src="'+a.src+'">',icons:{text:'▤',character:'♧',image:'▧'},edges:[{from:'a',to:'b'}]};
const btn=(label,act,attr='',cls='')=>'<button data-act="'+act+'" '+attr+' class="'+cls+'">'+label+'</button>';
const base={id:'a',x:30,y:75,type:'text',name:'剧本',prompt:'第一集\n1-1 日 内 庭院',assetIds:[],params:{ratio:'16:9',duration:5},locked:false};

test('actual script content is visible on the canvas card, with unchanged port actions and coordinates',()=>{
  const html=card(base,ctx);
  assert.match(html,/canvas-script-preview/);
  assert.match(html,/第一集/);
  assert.match(html,/left:30px;top:75px/);
  assert.match(html,/data-act="connect-in"/);
  assert.match(html,/data-act="connect-out"/);
  assert.match(html,/data-drag="a"/);
});

test('node renderer uses existing assets and never invents image sources',()=>{
  const html=card({...base,type:'character',assetIds:['reference'],name:'人物'},ctx);
  assert.match(html,/参考素材/);
  assert.match(html,/角色A/);
  assert.doesNotMatch(html,/canvas-node-empty/);
  const empty=card({...base,type:'image',assetIds:[],resultAssetId:undefined},ctx);
  assert.match(empty,/canvas-node-empty/);
  assert.match(empty,/待生成/);
});

test('untrusted prompt and node names are text, not inserted HTML',()=>{
  const html=card({...base,name:'<img src=x onerror=alert(1)>',prompt:'<script>alert(1)</script>'},ctx);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/<img src=x onerror/);
});

test('inspector preserves original settings and editing event attributes',()=>{
  const html=inspector({node:{...base,type:'image',assetIds:['reference']},asset:fakeAsset,button:btn,assetOptions:()=>'<option>选择首帧</option>',mediaHTML:ctx.mediaHTML,icons:ctx.icons,inputs:{nodes:['a','b'],assets:[]},totalNodes:2,totalEdges:1,totalAssets:1});
  for(const s of ['data-node-field="name"','data-node-field="prompt"','data-node-param="ratio"','data-node-param="firstFrame"','data-node-param="lastFrame"','data-act="bind-node"','data-act="node-task"','data-act="duplicate-node"','data-act="delete-node"']){
    assert.ok(html.includes(s),s);
  }
});

test('overview includes real graph counts and existing actions',()=>{
  const html=inspector({node:null,totalNodes:7,totalEdges:8,totalAssets:9,button:btn});
  assert.match(html,/>7<\/strong>/);
  assert.match(html,/data-act="shots-canvas"/);
  assert.match(html,/data-act="new-node"/);
});
