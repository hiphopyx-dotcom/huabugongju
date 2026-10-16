import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/studio/core.mjs';
import * as VT from '../public/studio/video-templates.mjs';
test('所有宣传与广告模板可套用真实品牌、素材和时长，时间段完整覆盖视频',()=>{
 const p=C.project();Object.assign(p.settings,{videoTemplateBrand:'剧爆棚',videoTemplateSubject:'影视创作工作台',videoTemplateAudience:'编剧与影视教师',videoTemplateSellingPoints:'多图参考\n逐镜编排',videoTemplateCTA:'预约演示',videoDuration:15,videoRatio:'9:16',videoRefs:['asset-1']});p.assets=[{id:'asset-1',name:'产品界面.png',kind:'image',description:'真实页面'}];
 assert.ok(VT.templates.length>=6);for(const template of VT.templates){p.settings.videoTemplateId=template.id;const d=VT.build(p);assert.equal(d.id,template.id);assert.match(d.prompt,/剧爆棚/);assert.match(d.prompt,/编剧与影视教师/);assert.match(d.prompt,/多图参考/);assert.match(d.prompt,/预约演示/);assert.match(d.prompt,/产品界面.png/);assert.match(d.prompt,/9:16/);assert.equal(d.segments[0].startSec,0);assert.equal(d.segments.at(-1).endSec,15);assert.equal(d.segments.reduce((n,s)=>n+Math.round((s.endSec-s.startSec)*10),0),150);assert.ok(!d.prompt.includes('undefined'));}
 const before=structuredClone(p);VT.build(p);assert.deepEqual(p,before);p.settings.videoTemplateId='unknown';assert.equal(VT.build(p).id,'enterprise');
});
test('模板兼容旧项目和不同视频长度，已有逐镜编排优先',()=>{const p=C.project();for(const duration of [1,5,15,30,60]){p.settings.videoDuration=duration;const d=VT.build(p);assert.equal(d.segments.at(-1).endSec,duration);assert.ok(d.segments.every(s=>s.endSec>s.startSec));}p.settings.videoSequence=true;assert.match(VT.build(p).prompt,/逐镜编排.*优先/);assert.equal(C.validate(JSON.parse(JSON.stringify(p))).settings.videoDuration,60);});
