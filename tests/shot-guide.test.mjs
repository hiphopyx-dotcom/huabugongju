import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/studio/core.mjs';
import * as SB from '../public/studio/storyboard.mjs';
test('演示选项应用到指定分镜并进入任务，预览其他选项不修改镜头',async()=>{
 const guide=await import('../public/studio/shot-guide.mjs');const p=C.project();p.shots=C.parseScript('第一集\n1-1 日 内 房间\n△甲转身。');const s=p.shots[0],before=structuredClone(s);
 assert.ok(guide.diagram('过肩镜头').includes('<svg'));assert.deepEqual(s,before);
 guide.applySelection(p,s.id,'camera','缓慢推进');assert.equal(s.camera,'缓慢推进');assert.match(SB.shotData(p,s).prompt,/缓慢推进.*dolly in/i);
 assert.throws(()=>guide.applySelection(p,s.id,'camera','伪造选项'));assert.throws(()=>guide.applySelection(p,s.id,'__proto__','x'));assert.throws(()=>guide.applySelection(p,'不存在','angle','俯拍'));
});
test('原模型所有景别、机位、构图、运镜都有对应演示机位和说明',async()=>{const {rigOf,SHOT_HINT}=await import('../public/studio/shot-rig.mjs');for(const [,label,options] of SB.groups.slice(0,4)){for(const option of options){assert.ok(SHOT_HINT[option.id],label+':'+option.id);const rig=rigOf(option.id);assert.ok(rig.pos.every(Number.isFinite));assert.ok(rig.look.every(Number.isFinite));assert.ok(rig.fov>0);}}});
test('视频镜头语言独立保存，参数和双语提示词都进入任务输入',async()=>{const guide=await import('../public/studio/shot-guide.mjs'),p=C.project();p.shots=C.parseScript('第一集\n1-1 日 内 房间\n△甲站起。');const before=structuredClone(p.shots);assert.equal(typeof guide.applyVideoSelection,'function');guide.applyVideoSelection(p,'camera','缓慢推进');guide.applyVideoSelection(p,'angle','过肩镜头');guide.applyVideoSelection(p,'lighting','伦勃朗光');p.settings.videoFocalLength='85';p.settings.videoAperture='f/2';p.settings.storyStyle='保持角色服装与场景';const d=SB.videoLanguage(p);assert.equal(d.params.camera,'缓慢推进');assert.equal(d.params.angle,'过肩镜头');assert.equal(d.params.focalLength,'85');assert.equal(d.params.aperture,'f/2');assert.match(d.prompt,/缓慢推进.*dolly in/i);assert.match(d.prompt,/伦勃朗光.*Rembrandt/);assert.match(d.prompt,/85 mm/);assert.match(d.prompt,/保持角色服装/);assert.deepEqual(p.shots,before);assert.throws(()=>guide.applyVideoSelection(p,'__proto__','x'));assert.throws(()=>guide.applyVideoSelection(p,'camera','伪造选项'));const restored=C.validate(JSON.parse(JSON.stringify(p)));assert.equal(SB.videoLanguage(restored).params.camera,'缓慢推进');});
test('鼠标经过和键盘聚焦不改变演示选择，点击才固定选项',async()=>{
 const guide=await import('../public/studio/shot-guide.mjs'),previous=globalThis.document,events={},nodes=new Map();
 const get=k=>{if(!nodes.has(k))nodes.set(k,{textContent:'',innerHTML:'',hidden:false,classList:{toggle(){}},focus(){},dataset:{}});return nodes.get(k)};
 const root={className:'',innerHTML:'',querySelector:get,querySelectorAll:()=>[],addEventListener:(k,fn)=>events[k]=fn,remove(){}};
 globalThis.document={activeElement:null,createElement:()=>root,body:{appendChild(){}},addEventListener(){},removeEventListener(){}};
 try{let applied;guide.open({project:C.project(),subject:{lighting:'自然光'},key:'lighting',onApply:(k,v)=>applied=[k,v]});const target=value=>({closest:s=>s==='[data-guide-value]'?{dataset:{guideValue:value}}:null});
 for(const type of ['pointerover','focusin'])events[type]?.({target:target('霓虹光')});
 const apply=()=>events.click({target:{closest:s=>s==='[data-guide-apply]'?{}:null}});apply();assert.deepEqual(applied,['lighting','自然光']);
 guide.open({project:C.project(),subject:{lighting:'自然光'},key:'lighting',onApply:(k,v)=>applied=[k,v]});events.click({target:target('伦勃朗光')});for(const type of ['pointerover','focusin'])events[type]?.({target:target('霓虹光')});apply();assert.deepEqual(applied,['lighting','伦勃朗光']);
 }finally{guide.close();globalThis.document=previous;}
});
