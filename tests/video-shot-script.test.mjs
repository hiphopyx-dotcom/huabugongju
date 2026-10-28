import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from '../pages/core.mjs';
import * as SB from '../pages/storyboard.mjs';
import * as VideoScript from '../pages/video-shot-script.mjs';
const png='data:image/png;base64,AA==';
const make=()=>{const p=C.project('双镜视频');p.script='完整原始剧本不能被替换';p.shots=[
 {id:'a',episode:'第一集',scene:'1-1',description:'女孩定格站在窗前',dialogue:'女孩：来了。',subtitle:'来了。',sourceText:'第1镜原文',assetId:'img1'},
 {id:'b',episode:'第一集',scene:'1-2',description:'男孩定格坐在桌旁',dialogue:'男孩：看见了。',subtitle:'看见了。',sourceText:'第2镜原文',assetId:'img2'},
 {id:'c',episode:'第一集',scene:'1-3',description:'侧脸定格',assetId:'img3'}];p.assets=['img1','img2','img3'].map(id=>({id,kind:'image',type:'分镜',src:png}));return p};
test('video panel receives exactly the four video-only fields without modifying still description',()=>{
 const p=make();const snap=SB.shotData(p,p.shots[0]).prompt;
 assert.deepEqual(VideoScript.FIELDS.map(x=>x[1]),['画面与动作','台词 / 声音','字幕','对应剧本原文']);
 p.shots[0].videoAction='她从窗边转身跑向门口';
 const s=VideoScript.shotScript(p.shots[0],0);
 assert.equal(s.action,'她从窗边转身跑向门口');
 assert.equal(p.shots[0].description,'女孩定格站在窗前');
 assert.equal(SB.shotData(p,p.shots[0]).prompt,snap);
});
test('selected adjacent first/last storyboard frames bring both script records to video request',()=>{
 const p=make(),selected=VideoScript.collectVideoScript(p,{sourcePair:{fromId:'a',toId:'b'},allowPair:true});
 assert.deepEqual(selected.shots.map(s=>s.shotId),['a','b']);
 for(const value of ['女孩：来了。','男孩：看见了。','第1镜原文','第2镜原文','字幕','画面与动作'])assert.ok(selected.prompt.includes(value),value);
 assert.deepEqual(selected.shots.map(s=>s.scene),['1-1','1-2']);
 assert.equal(p.script,'完整原始剧本不能被替换');
});
test('no invalid cross-scene pair contamination and selected shot is respected',()=>{
 const p=make();p.settings.videoScriptShotId='c';
 let s=VideoScript.collectVideoScript(p,{sourcePair:{fromId:'a',toId:'c'},allowPair:true});
 assert.deepEqual(s.shots.map(x=>x.shotId),['c']);
 p.settings.videoScriptShotId='b';s=VideoScript.collectVideoScript(p);
 assert.equal(s.shots[0].action,'男孩定格坐在桌旁');
});
test('legacy projects without videoAction display original description but do not duplicate source',()=>{
 const p=make();const shot=p.shots[0];delete shot.videoAction;
 assert.equal(VideoScript.shotScript(shot,0).action,shot.description);
 p.settings.videoScriptShotId='a';const s=VideoScript.collectVideoScript(p);
 assert.equal(s.prompt.match(/第1镜原文/g).length,1);
 assert.equal(s.prompt.match(/来了。/g).length,2); // dialogue and subtitle, not injected by the still model
});
test('shot page does not render motion/actions/dialogue/subtitles/original script editors; video page does',()=>{
 const src=readFileSync(new URL('../pages/app.mjs',import.meta.url),'utf8');
 const still=src.slice(src.indexOf('function shotsPage(){'),src.indexOf('function canvasPage(){'));
 const video=src.slice(src.indexOf('function videoShotScriptPanel(){'),src.indexOf('function videoPairsPanel(){'));
 for(const item of ["shotText(s,'description'", "shotText(s,'dialogue'", "shotText(s,'subtitle'", "shotText(s,'sourceText'", "data-shot=\"${s.id}\" data-key=\"videoAction\""])assert.ok(!still.includes(item),item);
 for(const key of ['videoAction','dialogue','subtitle','sourceText'])assert.ok(video.includes(`field('${key}'`),key);
 assert.ok(src.includes('data-video-script-shot'));
 assert.ok(src.includes('videoStory:videoStory.shots'));
 assert.ok(!src.includes("sourceText:s.sourceText||'',sourceLines:s.sourceLines"));
});
test('video sequence generation also carries per-video-shot action, dialogue, subtitle and source passage',()=>{
 const p=make();p.settings.videoSequence=true;p.settings.videoDuration=5;
 p.settings.videoShots=[{id:'v1',assetId:'img1',duration:5,description:'由窗边向门口移动',dialogue:'女孩：走吧。',subtitle:'走吧。',sourceText:'第2集视频原文',language:{}}];
 const result=SB.videoPlan(p);
 assert.equal(result.shots[0].description,'由窗边向门口移动');
 assert.equal(result.shots[0].dialogue,'女孩：走吧。');
 assert.equal(result.shots[0].sourceText,'第2集视频原文');
 for(const text of ['由窗边向门口移动','女孩：走吧。','字幕：走吧。','第2集视频原文'])assert.match(result.prompt,new RegExp(text));
});
