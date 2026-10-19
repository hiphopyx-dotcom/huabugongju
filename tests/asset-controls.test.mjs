import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyControls,enforceControls} from '../public/studio/asset-controls.mjs';
function project(){return {assets:[{id:'a',name:'原素材',src:'data:image/png;base64,AA==',description:'原描述'}],nodes:[{assetIds:['a'],resultAssetId:'a',params:{firstFrame:'a'}}],shots:[{assetId:'a',characters:['a']}],clips:[{assetId:'a'}],tasks:[{resultAssetId:'a',status:'completed'}],settings:{videoRefs:['a'],lastFrame:'a'}}}
const rule=(revision,flags={})=>({id:'a',name:'原素材',admin_revision:revision,admin_locked:false,admin_deleted:false,...flags});
test('管理员锁定仍可读取素材；成员改名、替换媒体或删除后恢复冻结快照，解锁才允许编辑',()=>{
 const p=project();applyControls(p,[rule(1,{admin_locked:true})]);assert.equal(p.assets[0].src,'data:image/png;base64,AA==');
 p.assets[0].name='篡改';p.assets[0].src='new';assert.equal(enforceControls(p),true);assert.equal(p.assets[0].name,'原素材');
 p.assets=[];applyControls(p,[rule(1,{admin_locked:true})]);assert.equal(p.assets[0].src,'data:image/png;base64,AA==');
 applyControls(p,[rule(2)]);p.assets[0].name='允许编辑';assert.equal(enforceControls(p),false);assert.equal(p.assets[0].name,'允许编辑');
 applyControls(p,[rule(1,{admin_locked:true})]);assert.equal(p.assets[0].adminLocked,false);
});
test('管理员删除清理引用；旧工程不能复活记录，恢复仍保留原媒体且不覆盖新引用',()=>{
 const p=project();applyControls(p,[rule(1,{admin_deleted:true})]);assert.equal(p.assets.length,0);assert.equal(p.nodes[0].assetIds.length,0);assert.equal(p.shots[0].assetId,'');assert.equal(p.clips.length,0);assert.equal(p.tasks[0].status,'blocked');assert.equal(p.settings.lastFrame,'');
 p.assets.push({id:'a',name:'旧导入'});assert.equal(enforceControls(p),true);assert.equal(p.assets.length,0);
 applyControls(p,[rule(2)]);assert.equal(p.assets[0].src,'data:image/png;base64,AA==');assert.equal(p.nodes[0].assetIds.length,0);
});
