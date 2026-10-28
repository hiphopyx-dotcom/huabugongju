import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from '../pages/core.mjs';
import * as SB from '../pages/storyboard.mjs';
import * as Refs from '../pages/shot-reference-library.mjs';
const png='data:image/png;base64,AA==';
function project(){const p=C.project('静态分镜测试');p.script='第一集\n△角色推门。\n角色：站住！';p.shots=[{id:'shot1',episode:'第一集',scene:'1-1 内 日',description:'女主手握门把手，回头看向镜头',dialogue:'角色：站住！',sourceText:p.script,subtitle:'站住！',camera:'缓慢推进',duration:5,assetId:''}];p.assets.push({id:'normal',name:'正式场景.png',kind:'image',type:'场景',src:png,created:1,locked:false,description:'正式场景'});return p}
test('uploading a shot reference binds it to this shot and the project reference library',()=>{
 const p=project();let n=0;
 const added=Refs.attachReferences(p,'shot1','characters',[{name:'女主正面.png',src:png,width:1536,height:2048}],()=>`r${++n}`);
 assert.equal(added.length,1);assert.equal(added[0].library,'reference');assert.equal(added[0].referenceRole,'角色');
 assert.deepEqual(p.shots[0].characters,['r1']);assert.equal(Refs.referenceAssets(p).length,1);
 assert.equal(Refs.referenceChoices(p,'角色').length,1);
 assert.equal(Refs.assetsForShelf(p,'all').length,1);
 assert.deepEqual(Refs.assetsForShelf(p,'reference').map(a=>a.id),['r1']);
 assert.equal(Refs.assetsForShelf(p,'场景').length,1);
 assert.equal(Refs.assetsForShelf(p,'角色').length,0);
});
test('reference images and script stay inside a self-contained project backup, not another global gallery',()=>{
 const p=project();Refs.attachReferences(p,'shot1','locations',[{name:'老宅.png',src:png,width:1000,height:1000}],()=> 'reference2');
 const copy=Refs.projectBackup(p);const restored=C.validate(JSON.parse(JSON.stringify(copy)));
 assert.equal(restored.assets.length,2);assert.equal(restored.assets[1].src,png);
 assert.equal(restored.assets[1].library,'reference');assert.deepEqual(restored.shots[0].locations,['reference2']);
 assert.equal(restored.shots[0].sourceText,p.script);assert.equal(restored.shots[0].dialogue,'角色：站住！');
 assert.equal(p.assets.length,2);copy.assets[1].name='更改副本';assert.equal(p.assets[1].name,'老宅.png');
});
test('invalid role, missing shot and malformed image never alter project assets',()=>{
 const p=project(),file={name:'坏图.png',src:'https://remote.example/a.png',width:100,height:100};
 assert.throws(()=>Refs.attachReferences(p,'shot1','no-such-role',[file]),/参考图用途/);
 assert.throws(()=>Refs.attachReferences(p,'missing','characters',[file]),/分镜已删除/);
 assert.throws(()=>Refs.attachReferences(p,'shot1','characters',[file]),/不是有效/);
 assert.equal(p.assets.length,1);assert.equal(p.shots[0].characters,undefined);
});
test('photo storyboard prompt has no spoken dialogue, subtitle, motion, schedule or quoted original script',()=>{
 const p=project();Refs.attachReferences(p,'shot1','props',[{name:'旧铜钥匙.png',src:png,width:900,height:900}],()=> 'prop1');
 const d=SB.shotData(p,p.shots[0]);assert.match(d.prompt,/静态电影分镜照片/);assert.match(d.prompt,/女主手握门把手/);
 assert.match(d.prompt,/旧铜钥匙/);assert.doesNotMatch(d.prompt,/角色：站住！|镜长 5 秒|缓慢推进|对应剧本原文：/);
 assert.equal(d.params.duration,5);assert.equal(d.params.sourceText,p.script);
 assert.deepEqual(d.assetIds,['prop1']); // a completed shot image and video-only first/last frames are not references
 const rows=SB.stillCsvRows(p);assert.equal(rows.length,2);assert.ok(rows[0].includes('单帧定格画面'));assert.ok(!rows[0].includes('台词')&&!rows[0].includes('字幕'));assert.equal(rows[0].length,rows[1].length);
});
test('visible storyboard panel does not mix in dialogue, subtitles, source text or video timing inputs',()=>{
 const src=readFileSync(new URL('../pages/app.mjs',import.meta.url),'utf8');
 const panel=src.slice(src.indexOf('function shotsPage(){'),src.indexOf('function canvasPage(){'));
 assert.ok(panel.includes("shotText(s,'description','静态画面描述'"));
 assert.ok(src.includes('data-shot-reference-file='));
 assert.ok(panel.includes('data-shot-result-file='));
 assert.ok(panel.includes('使用已分配 Grok 会员制作静态图'));
 assert.ok(!panel.includes("imageWorkshop.show({...SB.shotData"));
 for(const key of ['dialogue','subtitle','sourceText','startSec','nextGap','video-veo'])assert.ok(!panel.includes(`data-key="${key}"`)&&!panel.includes(`shotText(s,'${key}'`));
 assert.ok(panel.includes("!['camera','technique'].includes(key)"));
 assert.ok(src.includes('grokAccount'), 'existing Grok membership account assignment must remain');
 assert.ok(src.includes('准备已分配 Grok 会员视频')); assert.ok(!src.includes('veo-video.mjs'));
});

test('completed Grok still is stored as an ordinary project shot asset, not confused with the reference library',()=>{
 const p=project();const result=Refs.attachStillResult(p,'shot1',{name:'分镜1.png',src:png,width:1920,height:1080},()=> 'result1');
 assert.equal(result.type,'分镜');assert.equal(result.library,undefined);assert.equal(p.shots[0].assetId,'result1');
 assert.deepEqual(Refs.assetsForShelf(p,'reference'),[]);assert.equal(Refs.assetsForShelf(p,'all').length,2);
 const restored=C.validate(JSON.parse(JSON.stringify(Refs.projectBackup(p))));assert.equal(restored.shots[0].assetId,'result1');
});
test('membership handoff uses existing assigned module URLs rather than the paid image API',()=>{
 const app=readFileSync(new URL('../pages/app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('function openShotGrokHandoff(');const end=app.indexOf('async function importMedia(',start);
 assert.ok(start>0&&end>start);
 const block=app.slice(start,end);
 assert.match(block,/module-open&amp;module=storyboard/);assert.match(block,/module-open&amp;module=image/);
 assert.ok(!block.includes('imageRequest(')&&!block.includes("request('generate'"));
});
