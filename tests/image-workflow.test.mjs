import test from 'node:test';
import assert from 'node:assert/strict';
import {
 IMAGE_TABS, IMAGE_SLOTS, LOOK_STYLES, PORTRAIT_STYLES, PORTRAIT_PRESETS,
 IMAGE_ENTITY_FIELDS, freshImageWorkspace, deriveImageEntities, buildWorkflowPrompt,
 planImageBatch, imageSlotReferences,
} from '../public/studio/image-workflow.mjs';

const entity=(id,category,name=id,extra={})=>({id,category,name,scope:'episode',episode:'第一集',fields:{},...extra});
const item=(id,entityId,slot,extra={})=>({id,projectId:'p1',created:1,metadata:{entityId,slot,episode:'第一集'},...extra});
function fixture(){
 return {id:'p1',title:'验收作品',script:'不可从这句描述猜出未标注人物。',assets:[
  {id:'face-a',name:'阿青',kind:'image',type:'角色',src:'data:image/png;base64,AA==',description:'左眉有浅疤',locked:true},
  {id:'face-b',name:'老周',kind:'image',type:'character',src:'data:image/png;base64,AA==',description:'灰色长衫'},
  {id:'loc-a',name:'门房',kind:'image',type:'场景',src:'data:image/png;base64,AA==',description:'北窗西门'},
  {id:'prop-a',name:'铜铃',kind:'image',type:'道具',src:'data:image/png;base64,AA==',description:'锈斑'},
 ],settings:{ratio:'9:16',storyStyle:'阴雨灰绿；禁止换装',storyResolution:'2K'},shots:[
  {id:'shot1',name:'对话',episode:'第一集',scene:'门房',description:'阿青先把铃放下。\n老周停住，没伸手。',dialogue:'阿青：你听。\n老周：还没响。',duration:6,startSec:2,nextGap:0.5,
   characterNames:['阿青','老周'],locationNames:['门房'],propNames:['铜铃'],characters:['face-a','face-b'],locations:['loc-a'],reverseLocations:[],props:['prop-a'],angle:'过肩镜头',otsFrom:'face-a',otsTo:'face-b',otsBlock:'阿青在西，老周在东；二人均朝对方。',
   size:'中景',framing:'三分构图',camera:'固定镜头',stylize:'电影叙事',lighting:'电影级布光',technique:'长镜头',focalLength:'50',aperture:'f/2.8',ratio:'9:16',resolution:'2K',firstFrame:'face-a',lastFrame:'face-b',continuity:'铃在桌子北侧，右手放铃后收回。',negative:'禁止换脸、换装和镜像场景',sourceText:'△阿青先把铃放下。\n老周：还没响。',sourceLines:[12,13], 'emotion_face-a':'悲伤'},
  {id:'shot2',name:'对话',episode:'第二集',scene:'雨棚',description:'周蕙掀起帘子。',dialogue:'',duration:4,characterNames:['周蕙'],locationNames:['雨棚'],propNames:[],angle:'眼睛平视'},
 ]};
}
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value)}return value};

test('original production slots, styles, and editable fresh state are complete',()=>{
 assert.deepEqual(IMAGE_TABS.map(x=>x.id),['characters','locations','props','storyboard']);
 assert.deepEqual(IMAGE_SLOTS.characters.map(x=>x.id),['front','side','back','expr_smile','expr_anger','expr_stern','expr_cry','expr_sad','expr_fear','expr_provoke','expr_stare']);
 assert.deepEqual(IMAGE_SLOTS.locations.map(x=>x.id),['plan','view_n','view_w','view_e','view_s']);
 assert.equal(IMAGE_SLOTS.props[0].ratio,'1:1');
 assert.equal(LOOK_STYLES.length,17);
 assert.equal(PORTRAIT_STYLES.length,5);
 assert.equal(PORTRAIT_STYLES.flatMap(x=>x.options).length,15);
 assert.ok(PORTRAIT_PRESETS.some(x=>x.id==='skin:natural'));
 assert.doesNotMatch(JSON.stringify({LOOK_STYLES,PORTRAIT_STYLES,PORTRAIT_PRESETS}),/grok|x\.ai|provider|api[_-]?key/i);
 const a=freshImageWorkspace(),b=freshImageWorkspace();a.entities.push({id:'test'});
 assert.deepEqual(b,{entities:[],style:'',portraitStyle:''});
 assert.ok(Object.isFrozen(IMAGE_SLOTS.characters[0]));
});

test('derive accepts Chinese/English asset types, exact shot names, and preserves scoped custom fields',()=>{
 const p=fixture();p.imageWorkspace={entities:[
  entity('manual-a','characters','阿青',{scope:'series',episode:'',fields:{appearance:'保留管理员手工设定',costume:'深蓝外套'},owner:'must-not-copy',password:'must-not-copy'}),
  entity('yesterday','characters','同名',{scope:'episode',episode:'第一集',fields:{description:'第一集衣服'}}),
  entity('tomorrow','characters','同名',{scope:'episode',episode:'第二集',fields:{description:'第二集衣服'}}),
 ]};
 p.shots[0].characterNames.push('同名');
 p.shots[1].characterNames.push('同名');
 p.assets.push({id:'prop-b',type:'prop',name:'怀表',kind:'image',description:'表盖合上'});
 p.assets.push({id:'scene-b',type:'scene',name:'楼梯',kind:'image'});
 p.assets.push({id:'unknown',type:'video',name:'不得推测',kind:'video'});
 const original=structuredClone(p);let counter=0;
 const derived=deriveImageEntities(deepFreeze(p),()=> 'new-'+(++counter));
 assert.deepEqual(p,original);
 assert.equal(derived.filter(e=>e.category==='characters'&&e.name==='阿青').length,1);
 const a=derived.find(e=>e.id==='manual-a');
 assert.equal(a.fields.appearance,'保留管理员手工设定');assert.equal(a.fields.description,'左眉有浅疤');
 assert.equal(derived.filter(e=>e.name==='同名').length,2);
 assert.ok(derived.some(e=>e.id==='prop-a'&&e.category==='props'));
 assert.ok(derived.some(e=>e.id==='prop-b'&&e.category==='props'));
 assert.ok(derived.some(e=>e.id==='loc-a'&&e.category==='locations'));
 assert.ok(derived.some(e=>e.id==='scene-b'&&e.category==='locations'));
 assert.ok(derived.some(e=>e.category==='characters'&&e.name==='周蕙'&&e.episode==='第二集'));
 assert.equal(derived.filter(e=>e.category==='storyboard').length,2,'same-named shots must remain distinct');
 assert.equal(derived.find(e=>e.id==='shot1').hasReverse,true);
 assert.equal(derived.find(e=>e.id==='shot2').hasReverse,false);
 for(const e of derived){assert.deepEqual(Object.keys(e.fields).sort(),[...IMAGE_ENTITY_FIELDS].sort());assert.equal(e.projectId,undefined);assert.equal(e.description,undefined);assert.equal(e.owner,undefined);assert.equal(e.password,undefined);}
 assert.ok(!derived.some(e=>e.name==='不得推测'||e.name.includes('未标注人物')));
});

test('derive preserves persisted IDs, does not invent script entities, and drops removed storyboard shots',()=>{
 const p=fixture();let next=0;
 const first=deriveImageEntities(p,()=> 'stable-'+(++next));
 p.imageWorkspace={entities:[...first,entity('deleted-shot','storyboard','已删除分镜')]};
 const second=deriveImageEntities(p,()=>{throw Error('should not allocate again')});
 assert.deepEqual(second.map(e=>e.id),first.map(e=>e.id));
 assert.ok(!second.some(e=>e.id==='deleted-shot'));
 const empty=deriveImageEntities({script:'王五拿起宝剑，在皇宫里走动。',assets:[],shots:[]},()=> 'no-use');
 assert.deepEqual(empty,[]);
});

test('derive deduplicates by category, scope, episode, and name without merging different episodes',()=>{
 const p={assets:[],shots:[
  {id:'s1',episode:'一',scene:'仓库',characterNames:['陈晨','陈晨'],locationNames:['仓库'],propNames:['钥匙']},
  {id:'s2',episode:'一',scene:'仓库',characterNames:['陈晨'],locationNames:['仓库'],propNames:['钥匙']},
  {id:'s3',episode:'二',scene:'仓库',characterNames:['陈晨'],locationNames:['仓库'],propNames:['钥匙']},
 ]};
 let n=0;const out=deriveImageEntities(p,()=> 'e'+(++n));
 assert.equal(out.filter(e=>e.category==='characters').length,2);
 assert.equal(out.filter(e=>e.category==='locations').length,2);
 assert.equal(out.filter(e=>e.category==='props').length,2);
 assert.equal(out.filter(e=>e.category==='storyboard').length,3);
});

test('character templates respect identity, costume, expression, and original slot aspect',()=>{
 const p=fixture(),e=entity('a','characters','阿青',{fields:{role:'守门人',identityRegion:'中国 / 东亚面孔',age:'28岁',gender:'女',appearance:'左眉疤痕',costume:'深蓝长衫',description:'不能改成军装。'}});
 const result=buildWorkflowPrompt(p,e,'expr_cry',{style:'cinematic',portraitStyle:'skin:pores',referenceCount:1,extraPrompt:'右侧一颗痣不得消失。'});
 assert.equal(result.aspect,'1:1');assert.equal(result.sourceKind,'expr_cry');
 for(const phrase of ['阿青','守门人','28岁','左眉疤痕','深蓝长衫','哭泣','不能换脸','visible skin microstructure','阴雨灰绿；禁止换装','右侧一颗痣不得消失。'])assert.ok(result.prompt.includes(phrase),phrase);
 assert.equal(buildWorkflowPrompt(p,e,'front').aspect,'3:4');
 assert.equal(buildWorkflowPrompt(p,e,'front',{forceAspect:true}).aspect,'9:16');
 assert.throws(()=>buildWorkflowPrompt(p,e,'side',{referenceCount:4}),/0–3/);
 assert.throws(()=>buildWorkflowPrompt(p,e,'front',{portraitStyle:'unapproved'}),/质感/);
});

test('location plan and directional frames keep fixed world anchors and production order',()=>{
 const p=fixture(),e=entity('l','locations','门房',{fields:{heading:'内景 门房 夜',description:'北窗西门',timeOfDay:'夜',weather:'细雨',atmosphere:'压抑',worldAnchors:'北侧窗户；西侧木门；铜铃在桌北侧'}});
 const plan=buildWorkflowPrompt(p,e,'plan'),east=buildWorkflowPrompt(p,e,'view_e',{referenceCount:2});
 assert.equal(plan.aspect,'1:1');assert.equal(east.aspect,'9:16');
 assert.match(plan.prompt,/正交垂直俯视白模/);assert.match(plan.prompt,/不放人物/);
 assert.match(east.prompt,/东侧，朝西/);assert.match(east.prompt,/不能按画面左右重新布置/);
 assert.ok(east.prompt.includes(e.fields.worldAnchors));assert.match(east.prompt,/不镜像/);
 assert.equal(buildWorkflowPrompt(p,entity('prop','props','铜铃',{fields:{material:'氧化铜，有绿锈',usedBy:'阿青'}}),'hero').aspect,'1:1');
});

test('storyboard preserves every native film parameter, exact action/dialogue, negatives, and continuity',()=>{
 const p=fixture(),before=structuredClone(p),e=entity('shot1','storyboard','镜头一');
 const output=buildWorkflowPrompt(deepFreeze(p),e,'frame',{style:'noir',referenceCount:3});
 assert.deepEqual(p,before);
 assert.equal(output.aspect,'9:16');
 for(const field of ['duration','startSec','nextGap','size','angle','framing','camera','stylize','lighting','technique','focalLength','aperture','firstFrame','lastFrame','otsFrom','otsTo','otsBlock','styleLock','negative','continuity','sourceText','sourceLines','referenceRoles','emotions'])assert.deepEqual(output.params[field],({...before.shots[0],styleLock:before.settings.storyStyle,emotions:{'face-a':'悲伤','face-b':'保持参考'},referenceRoles:{characters:['face-a','face-b'],locations:['loc-a'],props:['prop-a']}})[field],field);
 for(const phrase of [p.shots[0].description,p.shots[0].dialogue,p.shots[0].sourceText,p.shots[0].continuity,p.shots[0].negative,'焦距：50 mm','光圈：f/2.8','过 阿青 的肩，拍 老周 的脸','开始 2 秒；镜长 6 秒；到下一张间隔 0.5 秒'])assert.ok(output.prompt.includes(phrase),phrase);
 assert.deepEqual(output.assetIds,['face-a','face-b','loc-a','prop-a']);
});

test('reverse coverage swaps the shoulder/face and scene refs, rejects missing or identical references',()=>{
 const p=fixture();p.assets.push({id:'loc-reverse',name:'门房反打',kind:'image',src:'data:image/png;base64,AA=='});p.shots[0].reverseLocations=['loc-reverse'];
 const out=buildWorkflowPrompt(p,entity('shot1','storyboard'),'reverse',{referenceCount:3});
 assert.equal(out.params.otsFrom,'face-b');assert.equal(out.params.otsTo,'face-a');
 assert.deepEqual(out.params.referenceRoles.locations,['loc-reverse']);
 assert.ok(out.prompt.includes('过 老周 的肩，拍 阿青 的脸'));assert.match(out.prompt,/180度轴线/);
 assert.ok(!out.assetIds.includes('loc-a'));
 p.shots[0].otsTo='face-a';assert.throws(()=>buildWorkflowPrompt(p,entity('shot1','storyboard'),'reverse'),/两个不同/);
 p.shots[0].otsTo='missing';assert.throws(()=>buildWorkflowPrompt(p,entity('shot1','storyboard'),'reverse'),/两个不同/);
 assert.throws(()=>buildWorkflowPrompt(p,entity('missing','storyboard'),'frame'),/已不存在/);
});

test('legacy top-level fields and original multi-control portrait grade remain usable',()=>{
 const result=buildWorkflowPrompt(fixture(),{id:'c',category:'characters',name:'老周',description:'白发',costume:'长衫'},'front',{portraitStyle:{blend:'natural',light:'match',skin:'natural',grain:'film',sharp:'standard',emotion:'calm'}});
 for(const phrase of ['白发','长衫','natural person-to-scene composite','face lighting strictly matches','fine photographic film grain','calm composed face'])assert.ok(result.prompt.includes(phrase),phrase);
});

test('portrait group selections round-trip through a string while unknown JSON fields stay out of prompts',()=>{
 const p=fixture(),e=entity('c','characters','老周'),grade={blend:'natural',light:'match',skin:'pores',grain:'film',sharp:'crisp',emotion:'calm'};
 const fromObject=buildWorkflowPrompt(p,e,'front',{portraitStyle:grade});
 const fromJSON=buildWorkflowPrompt(p,e,'front',{portraitStyle:JSON.stringify({...grade,password:'never-copy',provider:'never-copy'})});
 assert.equal(fromJSON.prompt,fromObject.prompt);
 assert.doesNotMatch(fromJSON.prompt,/never-copy|password|provider/);
 assert.throws(()=>buildWorkflowPrompt(p,e,'front',{portraitStyle:'{invalid'}),/人物质感选项无效/);
});

test('missing batch fills only empty slots, preserves order, and ignores deleted/other-project records',()=>{
 const characters=[entity('c1','characters'),entity('c2','characters')];
 const current=[item('front','c1','front'),item('old-side','c1','side',{deleted:true}),item('wrong-p','c2','front',{projectId:'p2'})];
 const result=planImageBatch({category:'characters',entities:characters,items:current,projectId:'p1'});
 assert.deepEqual(result[0],{entityId:'c1',slot:'side'});
 assert.equal(result.length,21);
 assert.deepEqual(result.slice(10,13),[{entityId:'c2',slot:'front'},{entityId:'c2',slot:'side'},{entityId:'c2',slot:'back'}]);
 const all=planImageBatch({category:'characters',entities:characters,items:current,mode:'all',projectId:'p1'});
 assert.equal(all.length,22);assert.equal(all[0].slot,'front');
 assert.throws(()=>planImageBatch({category:'characters',mode:'regenerate'}),/missing/);
});

test('episode batches retain series assets, avoid duplicate requests, and include only eligible reverse slots',()=>{
 const entities=[entity('series','locations','共用',{scope:'series',episode:''}),entity('one','locations','一'),entity('two','locations','二',{episode:'第二集'})];
 const locations=planImageBatch({category:'locations',entities:[...entities,entities[0]],episode:'第一集'});
 assert.equal(locations.length,10);assert.deepEqual(locations.slice(0,5).map(x=>x.slot),['plan','view_n','view_w','view_e','view_s']);
 const storyboard=planImageBatch({category:'storyboard',entities:[entity('s1','storyboard','s1',{hasReverse:true}),entity('s2','storyboard')],items:[item('frame','s1','frame')]});
 assert.deepEqual(storyboard,[{entityId:'s1',slot:'reverse'},{entityId:'s2',slot:'frame'}]);
});

test('slot matching respects episode/entity relations and supports backend metadata without category/scope',()=>{
 const e=entity('c','characters');
 const wrongEpisode=item('im','c','front',{metadata:{entityId:'c',slot:'front',episode:'第二集'}});
 const wrongEntity=item('another','different','side');
 assert.equal(planImageBatch({category:'characters',entities:[e],items:[wrongEpisode,wrongEntity]}).length,11);
 assert.equal(planImageBatch({category:'characters',entities:[e],items:[item('current','c','front')]}).length,10);
});

test('canonical references select latest same-entity identity or scene structure, never credentials or unrelated images',()=>{
 const c=entity('c','characters','阿青',{projectId:'p1'});
 const items=[item('old','c','front',{created:10,owner:'secret'}),item('new','c','front',{created:20,credentials:'secret'}),item('unrelated','different','front',{created:999}),item('wrong-project','c','front',{projectId:'p2',created:999}),item('gone','c','front',{created:999,deletedAt:3})];
 assert.deepEqual(imageSlotReferences(c,'side',items),[{id:'new'}]);assert.deepEqual(imageSlotReferences(c,'front',items),[]);
 const l=entity('l','locations','门房',{projectId:'p1'}),sceneItems=[item('north','l','view_n'),item('plan','l','plan'),item('other-scene','other','plan')];
 assert.deepEqual(imageSlotReferences(l,'plan',sceneItems),[]);
 assert.deepEqual(imageSlotReferences(l,'view_n',sceneItems),[{id:'plan'}]);
 assert.deepEqual(imageSlotReferences(l,'view_w',sceneItems),[{id:'plan'},{id:'north'}]);
 assert.deepEqual(imageSlotReferences(l,'view_e',sceneItems),[{id:'plan'},{id:'north'}]);
 assert.deepEqual(imageSlotReferences(l,'view_s',sceneItems),[{id:'plan'},{id:'north'}]);
 assert.throws(()=>imageSlotReferences(l,'front',sceneItems),/不支持/);
});

test('pure helpers do not mutate frozen entity/item lists and cannot silently use unknown slots',()=>{
 const entities=deepFreeze([entity('c','characters')]),items=deepFreeze([item('f','c','front')]),before=JSON.stringify({entities,items});
 planImageBatch({category:'characters',entities,items});imageSlotReferences(entities[0],'back',items);
 assert.equal(JSON.stringify({entities,items}),before);
 assert.throws(()=>buildWorkflowPrompt(fixture(),entities[0],'typo'),/不支持/);
 assert.throws(()=>planImageBatch({category:'wrong',entities,items}),/图片类型/);
});

