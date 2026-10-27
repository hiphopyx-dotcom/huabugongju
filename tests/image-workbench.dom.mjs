// Real DOM workflow acceptance. Every API and image read is mocked; this suite
// never requests a live generation, account, database, or upstream provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createImageWorkbench} from '../public/studio/image-workbench.mjs';
import {createImageWorkshop} from '../public/studio/image-workshop.mjs';
import {IMAGE_SLOTS} from '../public/studio/image-workflow.mjs';

let dom;
try { dom = await import('happy-dom'); }
catch { dom = await import(pathToFileURL(process.env.HAPPY_DOM_MODULE || '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href); }
const {Window} = dom;
const tick = async () => {for (let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve));};
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const clone = value => structuredClone(value);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const entity = (id='char-a',category='characters',name='阿青') => ({id,category,name,episode:'第一集',scope:'episode',fields:{description:'阿青穿旧青衫，手持铜铃。',identityRegion:'中国 / 东亚面孔',costume:'旧青衫'}});
const image = (id,entityId='char-a',slot='front',extra={}) => ({id,name:id,kind:'角色',source:'generated',prompt:'原图创作要求',ratio:'3:4',resolution:'1k',created:1793000000000,projectId:'project-a',metadata:{entityId,entityName:'阿青',slot,episode:'第一集'},...extra});
const project = (id='project-a') => ({id,title:'图片流程验收',script:'第一集\n1-1 夜 内 门房\n△阿青收起铜铃。',settings:{ratio:'9:16',storyStyle:'写实短剧'},assets:[{id:'ref-a',name:'阿青',kind:'image',type:'character',src:png,description:'旧青衫、东亚面孔'}],shots:[{id:'shot-a',episode:'第一集',scene:'1-1 夜 内 门房',description:'△阿青收起铜铃。',dialogue:'阿青：走。',sourceText:'△阿青收起铜铃。\n阿青：走。',characterNames:['阿青'],locationNames:['门房'],propNames:['铜铃'],characters:['ref-a'],locations:[],props:[],size:'特写',angle:'低机位',camera:'斯坦尼康跟拍',lighting:'伦勃朗光',technique:'慢动作',duration:6,continuity:'铜铃始终在右手'}]});

function fixture(t,{integrated=false,configure=()=>{}}={}) {
  const window=new Window({url:'https://jubaopeng-canvas.vercel.app/studio/index.html',settings:{disableIframePageLoading:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  const document=window.document;document.body.innerHTML='<main id="host"></main>';
  const host=document.querySelector('#host');
  const state={user:{id:'owner-a'},project:project(),workspace:{entities:[entity()],style:'',portraitStyle:''},version:3,items:[],jobs:[],calls:[],prepared:[],uses:[],scheduled:[],sequence:0,configured:true,generating:0,maxGenerating:0};
  configure(state);
  const request=async(action,body,params={})=>{
    const call={action,body:body?clone(body):undefined,params:{...params},owner:state.user?.id,projectId:state.project.id};state.calls.push(call);
    if(state.requestImpl){const r=state.requestImpl(call);if(r!==undefined)return await r;}
    if(action==='workspace'&&!body)return {workspace:clone(state.workspace),version:state.version};
    if(action==='workspace'){if(body.version!==state.version)throw Object.assign(Error('设定已在其他页面更新，请核对版本后保存'),{status:409});state.workspace=clone(body.workspace);return {workspace:clone(state.workspace),version:++state.version};}
    if(action==='slots')return {items:clone(state.items.filter(i=>i.projectId===params.projectId))};
    if(action==='status')return {configured:state.configured,rates:{image:1800},wallet:{available:90000},jobs:clone(state.jobs)};
    if(action==='list'){
      let list=state.items.filter(i=>(!params.projectId||i.projectId===params.projectId)&&(!params.entityId||i.metadata?.entityId===params.entityId)&&(!params.slot||i.metadata?.slot===params.slot)&&(!params.kind||i.kind===params.kind));
      const total=list.length,start=(Number(params.page||1)-1)*24;return {items:clone(list.slice(start,start+24)),total,jobs:clone(state.jobs)};
    }
    if(action==='generate'){
      const made=image('made-'+body.requestId,body.metadata?.entityId,body.metadata?.slot,{name:body.name,kind:body.kind,prompt:body.prompt,ratio:body.ratio,projectId:body.projectId,metadata:clone(body.metadata||{})});
      state.items.push(made);return {job:{status:'done',requestId:body.requestId},item:clone(made)};
    }
    if(action==='delete'){state.items=state.items.filter(i=>i.id!==body.id);return {ok:true};}
    throw Error('Unexpected mocked action: '+action);
  };
  const uuid=()=>`00000000-0000-4000-8000-${String(++state.sequence).padStart(12,'0')}`;
  const priorReader=globalThis.FileReader;globalThis.FileReader=window.FileReader;
  const api=integrated?createImageWorkshop({document,getProject:()=>state.project,getUser:()=>state.user,request,uuid,
    schedule:fn=>{state.scheduled.push(fn);return state.scheduled.length;},cancel:()=>{},
    fetchImage:async()=>({ok:true,blob:async()=>new window.File([Buffer.from(png.split(',')[1],'base64')],'image.png',{type:'image/png'})}),
    onUse:async(item,dataUrl,options)=>state.uses.push({item,dataUrl,options}),
  }):createImageWorkbench({getProject:()=>state.project,getUser:()=>state.user,request,uuid,
    getStatus:()=>({configured:state.configured,rates:{image:1800},wallet:{available:90000}}),
    onPrepare:data=>state.prepared.push(clone(data)),onGenerate:async data=>{state.generated||=[];state.generated.push(clone(data));return {job:{status:'done'},item:image('made-'+state.generated.length,data.metadata.entityId,data.metadata.slot,{metadata:clone(data.metadata)})};},
  });
  api.render(host);
  t.after(async()=>{api.unmount();globalThis.FileReader=priorReader;await window.happyDOM.abort();});
  const click=async selector=>{const el=host.querySelector(selector);assert.ok(el,selector);el.click();await tick();return el;};
  const input=(selector,value)=>{const el=host.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));return el;};
  const tab=async id=>click(`[data-flow-action="tab"][data-tab="${id}"]`);
  const submit=async()=>{const form=host.querySelector('[data-image-form]');assert.ok(form);form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
  return {window,document,host,state,api,click,input,tab,submit};
}

test('flow tabs load project settings lazily and reuse the authenticated snapshot',async t=>{
  const f=fixture(t);await tick();assert.deepEqual(f.state.calls,[]);
  assert.equal(f.host.querySelectorAll('[data-flow-action="tab"]').length,7);
  await f.tab('script');assert.deepEqual(f.state.calls.map(c=>c.action),['workspace','slots']);
  assert.match(f.host.textContent,/阿青收起铜铃/);
  await f.tab('characters');await f.tab('locations');await f.tab('free');await f.tab('characters');
  assert.equal(f.state.calls.filter(c=>c.action==='workspace').length,1);
  assert.equal(f.state.calls[0].params.projectId,'project-a');assert.equal(f.state.calls[0].owner,'owner-a');
});

test('a late workspace/slot response cannot leak across account or project changes',async t=>{
  for(const mode of ['account','project'])await t.test(mode,async t=>{
    const gate=deferred();let first=true;
    const f=fixture(t,{configure:s=>{s.requestImpl=c=>{if(c.action==='workspace'&&!c.body&&first){first=false;return gate.promise;}};}});
    await f.tab('characters');
    if(mode==='account')f.state.user={id:'owner-b'};else f.state.project=project('project-b');
    f.state.workspace={entities:[entity('char-new','characters','新范围人物')],style:'',portraitStyle:''};f.state.items=[];
    f.api.render(f.host);await f.tab('characters');
    gate.resolve({workspace:{entities:[entity('char-old','characters','旧范围秘密人物')],style:'',portraitStyle:''},version:99});await tick();
    assert.match(f.host.textContent,/新范围人物/);assert.doesNotMatch(f.host.textContent,/旧范围秘密人物/);
    assert.equal(f.host.querySelector('[data-flow-entity="name"]').value,'新范围人物');
  });
});

test('derive reads explicit storyboard entities and saving a stale version keeps unsaved creative text',async t=>{
  const f=fixture(t,{configure:s=>{s.workspace={entities:[],style:'',portraitStyle:''};}});
  await f.tab('breakdown');await f.click('[data-flow-action="derive"]');
  const saved=f.state.calls.find(c=>c.action==='workspace'&&c.body);
  assert.ok(saved);assert.equal(saved.body.version,3);
  const names=saved.body.workspace.entities.map(e=>[e.category,e.name]);
  assert.ok(names.some(([c,n])=>c==='characters'&&n==='阿青'));
  assert.ok(names.some(([c,n])=>c==='locations'&&n==='门房'));
  assert.ok(names.some(([c,n])=>c==='props'&&n==='铜铃'));
  await f.tab('characters');f.input('[data-flow-detail="description"]','未保存的人物描述：左眉有疤，旧青衫。');
  f.state.version+=1;await f.click('[data-flow-action="save"]');
  assert.equal(f.host.querySelector('[data-flow-detail="description"]').value,'未保存的人物描述：左眉有疤，旧青衫。');
  assert.match(f.host.textContent,/未保存修改/);assert.match(f.host.textContent,/其他页面更新|版本/);
  const count=f.state.calls.length;await f.click('[data-flow-action="reload"]');
  assert.equal(f.state.calls.length,count,'reload must not discard a dirty draft');
});

test('adding an entity while a prior save is pending keeps it dirty until the next save',async t=>{
  const gate=deferred();let pendingSave;
  const f=fixture(t,{configure:s=>{s.requestImpl=c=>{
    if(c.action==='workspace'&&c.body&&!pendingSave){pendingSave=c;return gate.promise;}
  };}});
  await f.tab('characters');f.input('[data-flow-detail="description"]','已提交的人物设定');
  await f.click('[data-flow-action="save"]');
  assert.equal(pendingSave.body.workspace.entities.length,1);
  await f.click('[data-flow-action="add"][data-category="characters"]');
  const added=f.api.getWorkspace().entities.at(-1);assert.equal(added.name,'新角色');
  f.state.workspace=clone(pendingSave.body.workspace);f.state.version+=1;
  gate.resolve({workspace:clone(f.state.workspace),version:f.state.version});await tick();
  assert.match(f.host.querySelector('.image-production .badge').textContent,/未保存修改/);
  assert.equal(f.state.workspace.entities.some(e=>e.id===added.id),false,'the first request did not contain the new entity');
  await f.click('[data-flow-action="save"]');
  assert.equal(f.state.workspace.entities.some(e=>e.id===added.id),true);
  assert.match(f.host.querySelector('.image-production .badge').textContent,/设定已同步/);
  await f.click('[data-flow-action="reload"]');
  assert.equal(f.api.getWorkspace().entities.some(e=>e.id===added.id),true,'the new entity survives a server reload');
});

test('character front and expression preparation retain descriptions, fixed ratios and canonical identity refs',async t=>{
  const f=fixture(t,{configure:s=>{s.items=[image('old-front'),image('canonical-front','char-a','front',{created:1793000010000})];}});
  await f.tab('characters');await f.click('[data-flow-action="prepare"][data-slot="front"]');
  const front=f.state.prepared.at(-1);assert.equal(front.params.ratio,'3:4');assert.deepEqual(front.libraryRefs,[]);
  assert.match(front.prompt,/正面/);assert.match(front.prompt,/旧青衫/);assert.equal(front.metadata.entityId,'char-a');assert.equal(front.metadata.slot,'front');
  await f.click('[data-flow-action="prepare"][data-slot="expr_smile"]');
  const smile=f.state.prepared.at(-1);assert.equal(smile.params.ratio,'1:1');assert.match(smile.prompt,/微笑/);
  assert.deepEqual(smile.libraryRefs,['canonical-front']);assert.equal(smile.metadata.slot,'expr_smile');assert.equal(smile.metadata.episode,'第一集');
  assert.doesNotMatch(smile.prompt,/grok|x\.ai|openai/i);
});

test('scene overhead plan and directional stills carry their correct ratio and structural anchors',async t=>{
  const f=fixture(t,{configure:s=>{s.workspace.entities=[entity('loc-a','locations','门房')];s.items=[image('scene-plan','loc-a','plan',{kind:'场景'}),image('scene-north','loc-a','view_n',{kind:'场景'})];}});
  await f.tab('locations');f.input('[data-flow-detail="worldAnchors"]','北门，东窗，西侧木桌。');
  await f.click('[data-flow-action="prepare"][data-slot="plan"]');let made=f.state.prepared.at(-1);
  assert.equal(made.params.ratio,'1:1');assert.deepEqual(made.libraryRefs,[]);assert.match(made.prompt,/正交|垂直俯视/);assert.match(made.prompt,/北门，东窗，西侧木桌/);
  await f.click('[data-flow-action="prepare"][data-slot="view_n"]');made=f.state.prepared.at(-1);
  assert.equal(made.params.ratio,'9:16');assert.deepEqual(made.libraryRefs,['scene-plan']);assert.match(made.prompt,/北侧.*朝南/);assert.equal(made.metadata.entityId,'loc-a');
  await f.click('[data-flow-action="prepare"][data-slot="view_w"]');made=f.state.prepared.at(-1);
  assert.deepEqual(made.libraryRefs,['scene-plan','scene-north']);assert.match(made.prompt,/西侧.*朝东/);
});

test('storyboard preparation preserves source action, camera language, continuity and reference assets',async t=>{
  const f=fixture(t);await f.tab('storyboard');await f.click('[data-flow-action="prepare"][data-slot="frame"]');
  const made=f.state.prepared.at(-1);assert.equal(made.shotId,'shot-a');assert.equal(made.metadata.entityId,'shot-a');assert.equal(made.metadata.slot,'frame');
  for(const text of ['△阿青收起铜铃。','阿青：走。','斯坦尼康跟拍','铜铃始终在右手','慢动作'])assert.ok(made.prompt.includes(text),text);
  assert.equal(made.params.ratio,'9:16');assert.deepEqual(made.assetIds,['ref-a']);
});

function leaveThreeCharacterSlots(s){s.items=IMAGE_SLOTS.characters.filter(slot=>!['front','side','back'].includes(slot.id)).map((slot,index)=>image('filled-'+index,'char-a',slot.id));}

test('missing-slot batch needs confirmation, submits sequentially, and allocates one request id per image',async t=>{
  const gates=[deferred(),deferred(),deferred()];
  const f=fixture(t,{integrated:true,configure:s=>{leaveThreeCharacterSlots(s);s.requestImpl=c=>{if(c.action==='generate'){s.generating++;s.maxGenerating=Math.max(s.maxGenerating,s.generating);const index=s.calls.filter(x=>x.action==='generate').length-1;return gates[index].promise.finally(()=>s.generating--);}};}});await tick();
  await f.tab('characters');await f.click('[data-flow-action="plan-group"]');
  assert.match(f.host.querySelector('.image-batch-confirm').textContent,/3 张/);assert.equal(f.state.calls.filter(c=>c.action==='generate').length,0);
  await f.click('[data-flow-action="batch-start"]');assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);
  for(let index=0;index<3;index++){
    const sent=f.state.calls.filter(c=>c.action==='generate')[index];assert.ok(sent);assert.equal(sent.body.metadata.slot,['front','side','back'][index]);
    assert.equal(sent.owner,'owner-a');assert.equal(sent.body.projectId,'project-a');assert.equal('ownerId' in sent.body,false);
    if(index)assert.deepEqual(sent.body.references,[{id:'batch-front'}]);
    const item=image(index?'batch-'+index:'batch-front','char-a',sent.body.metadata.slot,{metadata:clone(sent.body.metadata)});
    f.state.items.push(item);gates[index].resolve({job:{status:'done',requestId:sent.body.requestId},item});await tick();
    assert.equal(f.state.calls.filter(c=>c.action==='generate').length,Math.min(index+2,3));
  }
  const requests=f.state.calls.filter(c=>c.action==='generate');assert.equal(new Set(requests.map(c=>c.body.requestId)).size,3);assert.equal(new Set(requests.map(c=>c.body.metadata.batchId)).size,1);assert.ok(requests[0].body.metadata.batchId);
  assert.equal(f.state.maxGenerating,1);assert.match(f.host.textContent,/已完成 3 \/ 3/);assert.equal(f.state.uses.length,0,'generation must not silently adopt a candidate into the storyboard');
});

test('failed, uncertain and interrupted batch responses stop after one submission without automatic retry',async t=>{
  for(const mode of ['failed','uncertain','network'])await t.test(mode,async t=>{
    const f=fixture(t,{integrated:true,configure:s=>{leaveThreeCharacterSlots(s);s.requestImpl=c=>{if(c.action==='generate'){if(mode==='network')throw Error('响应中断');const job={status:mode,requestId:c.body.requestId,created:1793000000000,needsReview:mode==='uncertain'};s.jobs=[job];return {job};}};}});await tick();
    await f.tab('characters');await f.click('[data-flow-action="plan-group"]');await f.click('[data-flow-action="batch-start"]');await tick();
    assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);assert.match(f.host.textContent,/队列已暂停|后续队列已停止/);
    for(const fn of [...f.state.scheduled]){fn();await tick();}
    assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1,'a task/status refresh must not retry a paid generation');
  });
});

test('stopping a batch lets the submitted image finish and prevents the remaining paid requests',async t=>{
  const gate=deferred();const f=fixture(t,{integrated:true,configure:s=>{leaveThreeCharacterSlots(s);s.requestImpl=c=>c.action==='generate'?gate.promise:undefined;}});await tick();
  await f.tab('characters');await f.click('[data-flow-action="plan-group"]');await f.click('[data-flow-action="batch-start"]');
  const sent=f.state.calls.find(c=>c.action==='generate');await f.click('[data-flow-action="stop"]');
  gate.resolve({job:{status:'done',requestId:sent.body.requestId},item:image('stopped-front','char-a','front',{metadata:clone(sent.body.metadata)})});await tick();
  assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);assert.match(f.host.textContent,/已停止后续生成/);
});

test('a scope switch while a batch is awaiting its first result prevents subsequent requests',async t=>{
  const gate=deferred();const f=fixture(t,{integrated:true,configure:s=>{leaveThreeCharacterSlots(s);s.requestImpl=c=>c.action==='generate'?gate.promise:undefined;}});await tick();
  await f.tab('characters');await f.click('[data-flow-action="plan-group"]');await f.click('[data-flow-action="batch-start"]');
  const sent=f.state.calls.find(c=>c.action==='generate');f.state.user={id:'owner-b'};f.state.items=[];f.api.render(f.host);await tick();
  gate.resolve({job:{status:'done',requestId:sent.body.requestId},item:image('old-owner-result')});await tick();
  assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);assert.doesNotMatch(f.host.textContent,/old-owner-result/);
});

test('natural-language image editing creates a child version using the canonical original and preserves its file',async t=>{
  const original=image('original-front');const before=clone(original);
  const f=fixture(t,{integrated:true,configure:s=>{s.items=[clone(original)];}});await tick();
  await f.click('[data-image-action="edit"][data-id="original-front"]');
  f.input('[data-image-field="prompt"]','保留身份和服装，只把眼神改为警觉。');await f.submit();
  const sent=f.state.calls.find(c=>c.action==='generate');assert.ok(sent);assert.deepEqual(sent.body.references,[{id:'original-front'}]);assert.equal(sent.body.metadata.parentImageId,'original-front');
  assert.equal(sent.body.metadata.entityId,'char-a');assert.equal(sent.body.metadata.slot,'front');assert.deepEqual(f.state.items.find(i=>i.id==='original-front'),before);
  assert.equal(f.state.calls.some(c=>c.action==='delete'),false);assert.equal(f.state.items.length,2);
  const hrefs=[...f.host.querySelectorAll('.image-gallery-card a')].map(a=>a.getAttribute('href'));assert.ok(hrefs.includes('/api/images?action=content&id=original-front&download=1'));
});

test('locked gallery and history versions remain usable as references but cannot be edited or deleted',async t=>{
  const f=fixture(t,{integrated:true,configure:s=>{s.items=[image('locked-front','char-a','front',{adminLocked:true})];}});await tick();
  assert.equal(f.host.querySelector('[data-image-action="edit"]').disabled,true);assert.equal(f.host.querySelector('[data-image-action="delete"]').disabled,true);
  await f.click('[data-image-action="reference"]');assert.match(f.host.querySelector('[data-image-library-refs]').textContent,/1 张/);
  await f.tab('characters');await f.click('[data-flow-action="history"][data-slot="front"]');
  assert.equal(f.host.querySelector('[data-flow-action="edit"]').disabled,true);assert.equal(f.host.querySelector('[data-flow-action="reference"]').disabled,false);assert.equal(f.host.querySelector('[data-flow-action="use"]').disabled,false);
  assert.equal(f.state.calls.some(c=>['delete','generate'].includes(c.action)),false);
});

test('history has server pagination scoped to project/entity/slot, and the personal gallery retains all-page navigation',async t=>{
  const f=fixture(t,{integrated:true,configure:s=>{s.items=Array.from({length:27},(_,i)=>image('version-'+i));s.items.push(image('other-project','char-other','front',{projectId:'another-project'}));}});await tick();
  assert.equal(f.host.querySelectorAll('[data-image-gallery] .image-gallery-card').length,24);
  await f.click('[data-image-action="next"]');assert.equal(f.state.calls.filter(c=>c.action==='list').at(-1).params.page,'2');assert.equal(f.host.querySelectorAll('[data-image-gallery] .image-gallery-card').length,4);
  await f.tab('characters');await f.click('[data-flow-action="history"][data-slot="front"]');
  let call=f.state.calls.filter(c=>c.action==='list').at(-1);assert.deepEqual(call.params,{projectId:'project-a',entityId:'char-a',slot:'front',page:'1'});
  assert.equal(f.host.querySelectorAll('.image-history-panel .image-gallery-card').length,24);await f.click('[data-flow-action="history-next"]');
  call=f.state.calls.filter(c=>c.action==='list').at(-1);assert.equal(call.params.page,'2');assert.equal(f.host.querySelectorAll('.image-history-panel .image-gallery-card').length,3);
  assert.doesNotMatch(f.host.querySelector('.image-history-panel').textContent,/other-project/);
});

test('a late history response cannot replace another entity history or show its stale error',async t=>{
  for(const result of ['success','error'])await t.test(result,async t=>{
    const gate=deferred();
    const f=fixture(t,{configure:s=>{
      s.workspace.entities.push(entity('char-b','characters','阿宁'));
      s.items=[image('old-a'),image('current-b','char-b')];
      s.requestImpl=c=>c.action==='list'&&c.params.entityId==='char-a'?gate.promise:undefined;
    }});
    await f.tab('characters');await f.click('[data-flow-action="history"][data-id="char-a"][data-slot="front"]');
    await f.click('[data-flow-action="entity"][data-id="char-b"]');
    await f.click('[data-flow-action="history"][data-id="char-b"][data-slot="front"]');
    assert.match(f.host.querySelector('.image-history-panel').textContent,/current-b/);
    if(result==='success')gate.resolve({items:[image('old-a')],total:1});
    else gate.reject(Error('旧人物历史读取失败'));
    await tick();
    assert.match(f.host.querySelector('.image-history-panel').textContent,/current-b/);
    assert.doesNotMatch(f.host.querySelector('.image-history-panel').textContent,/old-a/);
    assert.doesNotMatch(f.host.textContent,/旧人物历史读取失败/);
  });
});

test('deletion requires a second confirmation, and an old account confirmation cannot delete under a new owner',async t=>{
  const f=fixture(t,{integrated:true,configure:s=>{s.items=[image('delete-me')];}});await tick();
  await f.click('[data-image-action="delete"]');assert.equal(f.state.calls.some(c=>c.action==='delete'),false);
  await f.click('[data-image-action="delete-cancel"]');assert.equal(f.host.querySelector('[data-image-delete-confirm]'),null);
  await f.click('[data-image-action="delete"]');const old=f.host.querySelector('[data-image-action="delete-confirm"]');
  f.state.user={id:'owner-b'};old.click();await tick();assert.equal(f.state.calls.some(c=>c.action==='delete'),false);
  f.api.render(f.host);await tick();await f.click('[data-image-action="delete"]');await f.click('[data-image-action="delete-confirm"]');
  const removed=f.state.calls.find(c=>c.action==='delete');assert.equal(removed.owner,'owner-b');assert.deepEqual(removed.body,{id:'delete-me'});assert.equal(f.state.items.length,0);
});
