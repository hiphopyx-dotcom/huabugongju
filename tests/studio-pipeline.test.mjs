import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from '../pages/core.mjs';
import * as Pipeline from '../pages/studio-pipeline.mjs';
import * as SB from '../pages/storyboard.mjs';
const png='data:image/png;base64,AA==';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
function sample(){
 const p=C.project('分镜之间变成视频');p.script='已有剧本完整保存，不应替换';
 p.assets=[['cast','角色'],['place','场景'],['object','道具'],['a','分镜'],['b','分镜'],['c','分镜']].map(([id,type])=>({id,name:id,kind:'image',type,src:png,created:1,locked:false,description:''}));
 p.shots=[1,2,3].map((n,i)=>({id:'s'+n,episode:'第1集',scene:'1-'+n,description:'第'+n+'个定格画面',dialogue:'保留对白'+n,sourceText:'对应剧本原文'+n,assetId:['a','b','c'][i],duration:5,ratio:'16:9'}));
 return p;
}
test('four stages are unambiguous and existing scripts may enter at image step',()=>{
 assert.deepEqual(Pipeline.STAGES.map(x=>x.id),['writing','image','shots','video']);
 const src=read('../pages/app.mjs');
 assert.match(src,/导入已有剧本并拆解/);assert.match(src,/imageImportActive/);
 assert.match(src,/onShots:\(\)=>\{if\(imageImportActive\)/);
 assert.match(src,/imageWorkshop\.openFlowTab\('breakdown'\)/);
 assert.match(src,/分镜素材融合/);assert.match(src,/shot-compose-to-image/);
});
test('images are drawn only from this project and classified by character, scene and prop',()=>{
 const p=sample(); assert.deepEqual(Pipeline.imageCounts(p),{'角色':1,'场景':1,'道具':1});
 const got=Pipeline.bindComposition(p,'s1',['place','cast','object','cast']);
 assert.deepEqual(got,{characters:['cast'],locations:['place'],props:['object']});
 assert.deepEqual(p.shots[0].characters,['cast']);
 assert.throws(()=>Pipeline.bindComposition(p,'s2',['another-project-asset']),/不属于当前项目/);
 assert.equal(p.shots[1].characters,undefined);
 assert.equal(p.assets.length,6);
});
test('completed neighboring stills become ordered first/last frames without paid generation',()=>{
 const p=sample();const pairs=Pipeline.stillPairs(p);
 assert.deepEqual(pairs.map(x=>[x.fromAsset.id,x.toAsset.id]),[['a','b'],['b','c']]);
 const selection=Pipeline.videoBetweenStills(p,'s2','s3');
 assert.equal(selection.firstFrame,'b');assert.equal(selection.lastFrame,'c');
 assert.match(selection.prompt,/第2个定格画面/);assert.match(selection.prompt,/第3个定格画面/);
 assert.throws(()=>Pipeline.videoBetweenStills(p,'s1','s3'),/相邻/);
 p.shots[1].assetId='';assert.equal(Pipeline.stillPairs(p)[0].ready,false);
 assert.throws(()=>Pipeline.videoBetweenStills(p,'s1','s2'),/完成并绑定/);
});
test('detailed filming control lives in video task, not basic images or still-frame composition',()=>{
 const p=sample();p.shots[0].focalLength='85';p.shots[0].aperture='f/2';p.shots[0].camera='快速推进';
 p.settings.videoColorGrade='冷色电影感';p.settings.videoFocalLength='35';p.settings.videoAperture='f/4';
 const still=SB.shotData(p,p.shots[0]);
 assert.doesNotMatch(still.prompt,/焦距：85|光圈：f\/2|快速推进|视频色调/);
 const video=SB.videoLanguage(p);
 assert.match(video.prompt,/冷色电影感/);assert.match(video.prompt,/35 mm/);
 assert.equal(video.params.colorGrade,'冷色电影感');
 const src=read('../pages/app.mjs');assert.match(src,/data-setting="videoColorGrade"/);
 assert.match(src,/function videoPairsPanel/);assert.match(src,/video-pair-use/);
 assert.match(src,/videoTransitionPrompt=config.prompt/); assert.ok(!src.includes('P.settings.videoPrompt=config.prompt'));
});
test('previous script, shot dialogue and project assets survive four stage transitions and backups',()=>{
 const p=sample();Pipeline.bindComposition(p,'s1',['cast','place','object']);
 const v=Pipeline.videoBetweenStills(p,'s1','s2');
 p.settings.videoMethod='首尾帧';p.settings.firstFrame=v.firstFrame;p.settings.lastFrame=v.lastFrame;
 const restored=C.validate(JSON.parse(JSON.stringify(p)));
 assert.equal(restored.script,'已有剧本完整保存，不应替换');
 assert.equal(restored.shots[0].sourceText,'对应剧本原文1');
 assert.equal(restored.shots[0].dialogue,'保留对白1');
 assert.equal(restored.settings.firstFrame,'a');assert.equal(restored.settings.lastFrame,'b');
 assert.equal(restored.assets.length,6);
});
