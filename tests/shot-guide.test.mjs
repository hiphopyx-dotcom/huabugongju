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
