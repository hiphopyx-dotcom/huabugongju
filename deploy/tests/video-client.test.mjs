import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planVideoJobs} from '../../pages/veo-video.mjs';
const A={id:'actor1',name:'陆川',kind:'image',locked:true};
const B={id:'scene1',name:'客厅',kind:'image',locked:false};
function p(settings){return {id:'project1',title:'桂花香起爱归来',assets:[A,B],settings:{videoPrompt:'二人发生激烈冲突',videoRatio:'9:16',videoDuration:5,videoRefs:['scene1','actor1'],...settings}}}
test('overall generation plans bind a priority locked character reference',()=>{
 const items=planVideoJobs(p({videoMethod:'多参考图'}));
 assert.equal(items.length,1);assert.equal(items[0].mode,'references');
 assert.deepEqual(items[0].refIds,['actor1','scene1']);
 assert.deepEqual(items[0].referenceIds,['actor1','scene1']);
 assert.match(items[0].prompt,/避免换脸/);
});
test('two real story shots become independent generation jobs, not one long video',()=>{
 const items=planVideoJobs(p({videoSequence:true,videoMethod:'文生视频',videoShots:[
  {id:'shot1',assetId:'actor1',duration:4,description:'陆川走进客厅'},
  {id:'shot2',assetId:'scene1',duration:6,description:'周宁放下茶杯'}]}));
 assert.equal(items.length,2);
 assert.deepEqual(items.map(x=>x.shotId),['shot1','shot2']);
 assert.deepEqual(items.map(x=>x.mode),['start','start']);
 assert.equal(items[0].requestedDuration,4);
 assert.equal(items[1].requestedDuration,6);
 assert.equal(items[0].duration,8);
 assert.notEqual(items[0].prompt,items[1].prompt);
});
test('first-last frame anchors reference IDs without mixing incompatible reference-image modes',()=>{
 const item=planVideoJobs(p({videoMethod:'首尾帧',firstFrame:'actor1',lastFrame:'scene1'}))[0];
 assert.equal(item.mode,'interpolate');
 assert.equal(item.firstId,'actor1');
 assert.equal(item.lastId,'scene1');
 assert.deepEqual(item.refIds,[]);
});
test('text-only video does not silently attach private reference images',()=>{
 const item=planVideoJobs(p({videoMethod:'文生视频'}))[0];
 assert.equal(item.mode,'text');
 assert.deepEqual(item.referenceIds,[]);
});
