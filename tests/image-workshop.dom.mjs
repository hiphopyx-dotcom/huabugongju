// Optional real-DOM acceptance: node --test tests/image-workshop.dom.mjs
// No paid generation or live service is used. HAPPY_DOM_MODULE may override the
// installed DOM dependency; /tmp matches the existing writing acceptance suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createImageWorkshop, imageRequest, imageContentUrl} from '../public/studio/image-workshop.mjs';

let dom;
try {dom = await import('happy-dom');}
catch {dom = await import(pathToFileURL(process.env.HAPPY_DOM_MODULE || '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href);}
const {Window} = dom;
const tick = async () => {for (let i=0;i<4;i++) await new Promise(resolve => setImmediate(resolve));};
// Native Web Crypto promises are not tracked by Happy DOM's task manager.
// Wait for the relevant request/UI state with a deadline instead of a turn count.
const waitFor = async (condition,description,timeoutMs=2000) => {
  const deadline=performance.now()+timeoutMs;
  for(;;){const result=condition();if(result)return result;
    assert.ok(performance.now()<deadline,'Timed out waiting for '+description);
    await new Promise(resolve=>setTimeout(resolve,1));
  }
};
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const image = (id='image-a', name='本人图片') => ({id,name,kind:'角色',source:'generated',prompt:'同一角色',created:1792970000000});
const project = (id='project-a') => ({id,title:'当前作品',settings:{ratio:'16:9'},assets:[{id:'ref-a',name:'角色参考',kind:'image',src:png}],shots:[{id:'shot-a',description:'△她收起铜铃。',dialogue:'阿青：走。',scene:'2-1 夜 内 门房',characters:['ref-a'],locations:[],props:[]}]});
const file = value => {const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};};
const oldRow = row => ({user_id:'old-own-user',project_id:'old-p',episode_id:'old-ep',...row});
function backup() {
  return {at:1792970000000,user_id:'old-own-user',data:{
    jingben_projects:[oldRow({id:'old-p',title:'迁入旧作'})],
    jingben_episodes:[oldRow({id:'old-ep',ep_no:1,title:'旧第一集'})],
    jingben_characters:[oldRow({id:'old-char',name:'迁入角色',scope:'series'})],
    jingben_images:[
      oldRow({id:'old-own-image',entity_id:'old-char',kind:'front',prompt:'保留原提示词',image_url:png}),
      oldRow({id:'old-unselected',entity_id:'old-char',kind:'side',prompt:'UNSELECTED-CREATIVE-TEXT',image_url:png}),
    ],
    jingben_members:[{user_id:'old-own-user',phone:'PRIVATE-PHONE',password_hash:'PRIVATE-PASSWORD-HASH'}],
    account:[{accessToken:'PRIVATE-ACCESS-TOKEN'}],
  }};
}

function fixture(t, configure = () => {}) {
  const window=new Window({url:'https://jubaopeng-canvas.vercel.app/studio/index.html',settings:{disableIframePageLoading:true,disableJavaScriptFileLoading:true}});
  const document=window.document;document.body.innerHTML='<main id="host"></main>';
  const state={user:{id:'user-a'},project:project(),calls:[],fetches:[],uses:[],toasts:[],scheduled:[],sequence:0,items:[image()],jobs:[],configured:true};
  configure(state);
  const host=document.querySelector('#host');
  const request=async(action,body,params={})=>{
    const call={action,body:body?structuredClone(body):undefined,params:{...params},userId:state.user?.id,projectId:state.project.id};state.calls.push(call);
    if(state.requestImpl){const result=state.requestImpl(call);if(result!==undefined)return await result;}
    if(action==='status')return {configured:state.configured,rates:{image:1800},wallet:{available:9000},jobs:structuredClone(state.jobs)};
    if(action==='list')return {items:structuredClone(state.items),jobs:structuredClone(state.jobs),total:state.items.length};
    if(action==='import')return {item:image('imported-image',body.name)};
    if(action==='generate')return {job:{status:'done',requestId:body.requestId}};
    throw Error('unexpected request '+action);
  };
  const fetchImage=async(url,options)=>{state.fetches.push({url,options});if(state.fetchImpl)return state.fetchImpl(url,options);return {ok:true,blob:async()=>new window.File([Buffer.from(png.split(',')[1],'base64')],'image.png',{type:'image/png'})};};
  const priorReader=globalThis.FileReader;globalThis.FileReader=window.FileReader;
  const api=createImageWorkshop({document,getProject:()=>state.project,getUser:()=>state.user,request,fetchImage,
    uuid:()=>`00000000-0000-4000-8000-${String(++state.sequence).padStart(12,'0')}`,
    schedule:fn=>{state.scheduled.push(fn);return state.scheduled.length;},cancel:()=>{},
    onUse:async(item,dataUrl,options)=>{state.uses.push({item,dataUrl,options,userId:state.user?.id,projectId:state.project.id});},
    toast:text=>state.toasts.push(text),
  });
  api.render(host);
  t.after(async()=>{api.unmount();globalThis.FileReader=priorReader;await window.happyDOM.abort();});
  const click=async selector=>{const el=document.querySelector(selector);assert.ok(el,selector);el.click();await tick();await window.happyDOM.waitUntilComplete();await tick();return el;};
  const input=(selector,value)=>{const el=document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));return el;};
  const submit=async()=>{const form=document.querySelector('[data-image-form]');assert.ok(form);form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
  const uploadBackup=async(value)=>{const el=document.querySelector('[data-image-backup]');assert.ok(el);Object.defineProperty(el,'files',{configurable:true,value:[value]});el.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();};
  const pick=(sourceId,checked=true)=>{const el=[...document.querySelectorAll('[data-image-import-id]')].find(e=>e.dataset.imageImportId===sourceId);assert.ok(el,sourceId);el.checked=checked;return el;};
  const confirm=(checked=true)=>{const el=document.querySelector('[data-image-confirm-own]');assert.ok(el);el.checked=checked;};
  return {window,document,host,state,api,click,input,submit,uploadBackup,pick,confirm};
}

test('personal gallery and download links use the authenticated same-origin content route with escaped text', async t=>{
  const hostile='\"><img src=x onerror="alert(1)"><script>bad</script>';
  const f=fixture(t,s=>{s.items=[{...image('safe-id',hostile),prompt:'</p><script>bad</script>'}];s.project.assets[0].name=hostile;});await tick();
  assert.deepEqual(f.state.calls.map(c=>c.action),['status','list']);
  assert.match(f.host.textContent,/本站账号 · 个人图库/);assert.match(f.host.textContent,/1800|1,800/);
  assert.equal(f.host.querySelector('script'),null);assert.equal(f.host.querySelector('[onerror]'),null);
  for(const a of f.host.querySelectorAll('.image-gallery-card a')){assert.match(a.getAttribute('href'),/^\/api\/images\?/);assert.equal(a.getAttribute('href').includes('access='),false);}
  assert.equal(imageContentUrl({id:'safe-id'}),'/api/images?action=content&id=safe-id');
  assert.throws(()=>imageContentUrl({id:'../private?token=secret'}),/无效/);
});

test('anonymous users cannot read a gallery or submit a paid generation', async t=>{
  const f=fixture(t,s=>{s.user=null;});await tick();assert.deepEqual(f.state.calls,[]);
  assert.equal(f.document.querySelector('[data-image-form]'),null);assert.ok(f.document.querySelector('[data-account="login"]'));
});

test('image HTTP helper sends only same-origin requests and hides model service identity in errors', async()=>{
  const prior=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({ok:true})};};
  try{
    await imageRequest('list',null,{page:'2'});await imageRequest('import',{requestId:'id',name:'图',dataUrl:png});
    assert.equal(calls[0].url,'/api/images?action=list&page=2');assert.equal(calls[0].opts.credentials,'same-origin');assert.equal(calls[0].opts.method,'GET');
    assert.equal(calls[1].opts.method,'POST');assert.equal(JSON.parse(calls[1].opts.body).dataUrl,png);
    globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Grok x.ai private upstream error'})});
    await assert.rejects(()=>imageRequest('status'),e=>!/grok|x\.ai/i.test(e.message));
    globalThis.fetch=async()=>({ok:false,status:429,json:async()=>({error:'额度不足'})});
    await assert.rejects(()=>imageRequest('generate',{}),e=>e.rejected===true);
    globalThis.fetch=async()=>({ok:false,status:408,json:async()=>({error:'请求超时'})});
    await assert.rejects(()=>imageRequest('generate',{}),e=>e.rejected===false);
    globalThis.fetch=async()=>({ok:true,json:async()=>{throw Error('broken JSON');}});
    await assert.rejects(()=>imageRequest('generate',{}),/不要重复提交/);
  }finally{globalThis.fetch=prior;}
});

test('two immediate submits create one paid request with current references; success requires explicit use', async t=>{
  const gate=deferred();const f=fixture(t,s=>{s.requestImpl=c=>c.action==='generate'?gate.promise:undefined;});await tick();
  f.input('[data-image-field="name"]','角色甲');f.input('[data-image-field="kind"]','角色');f.input('[data-image-field="prompt"]','同一张脸，东亚面孔');
  const ref=f.document.querySelector('[data-image-ref]');ref.checked=true;ref.dispatchEvent(new f.window.Event('input',{bubbles:true}));
  await f.submit();await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);
  const paid=f.state.calls.find(c=>c.action==='generate');
  assert.deepEqual(paid.body.references,[{dataUrl:png}]);assert.equal(paid.body.projectId,'project-a');assert.equal(paid.body.prompt,'同一张脸，东亚面孔');assert.equal(paid.body.kind,'角色');
  assert.equal('ownerId' in paid.body,false);assert.equal('provider' in paid.body,false);
  gate.resolve({job:{status:'done',requestId:paid.body.requestId}});await tick();
  assert.equal(f.state.uses.length,0);assert.equal(f.state.project.assets.length,1);assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);
  await f.click('[data-image-action="use"]');assert.equal(f.state.uses.length,1);assert.equal(f.state.uses[0].options.expected,'user-a:project-a');assert.equal(f.state.uses[0].dataUrl.startsWith('data:image/png;base64,'),true);
});

test('late gallery responses cannot overwrite the newly selected account or project', async t=>{
  for(const mode of ['account','project'])await t.test(mode,async t=>{
    const old=deferred();let first=true;
    const f=fixture(t,s=>{s.requestImpl=c=>{if(c.action==='list'&&first){first=false;return old.promise;}};});await tick();
    if(mode==='account')f.state.user={id:'user-b'};else f.state.project=project('project-b');
    f.state.items=[image('new-image','新范围图片')];f.api.render(f.host);await tick();
    old.resolve({items:[image('old-image','旧范围秘密图片')],jobs:[],total:1});await tick();
    assert.match(f.host.textContent,/新范围图片/);assert.equal(f.host.textContent.includes('旧范围秘密图片'),false);assert.equal(f.state.uses.length,0);
  });
});

test('late generation and content reads cannot add old images to the new account or project', async t=>{
  for(const mode of ['account','project'])await t.test(mode,async t=>{
    const generation=deferred();const f=fixture(t,s=>{s.requestImpl=c=>c.action==='generate'?generation.promise:undefined;});await tick();
    f.input('[data-image-field="prompt"]','旧范围画面要求');await f.submit();
    const sent=f.state.calls.find(c=>c.action==='generate');
    if(mode==='account')f.state.user={id:'user-b'};else f.state.project=project('project-b');
    f.state.items=[image('new-image','新范围图片')];f.api.render(f.host);await tick();
    generation.resolve({job:{status:'done',requestId:sent.body.requestId},item:image('old-generated','旧生成图片')});await tick();
    assert.equal(f.host.textContent.includes('旧生成图片'),false);assert.equal(f.state.uses.length,0);assert.equal(f.state.project.assets.length,1);
    const content=deferred();f.state.fetchImpl=()=>content.promise;await f.click('[data-image-action="use"]');
    if(mode==='account')f.state.user={id:'user-c'};else f.state.project=project('project-c');
    f.api.render(f.host);await tick();
    content.resolve({ok:true,blob:async()=>new f.window.File([Buffer.from(png.split(',')[1],'base64')],'a.png',{type:'image/png'})});await tick();await f.window.happyDOM.waitUntilComplete();await tick();
    assert.equal(f.state.uses.length,0);
  });
});

test('an unchanged-scope redraw does not leave the workshop permanently busy after a confirmed result', async t=>{
  const gate=deferred();const f=fixture(t,s=>{s.requestImpl=c=>c.action==='generate'?gate.promise:undefined;});await tick();
  f.input('[data-image-field="prompt"]','待生成图');await f.submit();const sent=f.state.calls.find(c=>c.action==='generate');
  f.state.jobs=[{requestId:sent.body.requestId,status:'running',needsReview:true,created:1792970000000}];f.api.render(f.host);await tick();
  assert.equal(f.document.querySelector('[data-image-generate]').disabled,true);
  f.state.jobs=[{requestId:sent.body.requestId,status:'done',needsReview:false,created:1792970000000}];await f.api.refresh();await tick();
  gate.resolve({job:{status:'done',requestId:sent.body.requestId}});await tick();
  assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);
});

test('a late completion for an older request cannot remove a newer request protection in the same view', async t=>{
  const first=deferred(),second=deferred();let number=0;
  const f=fixture(t,s=>{s.requestImpl=c=>c.action==='generate'?(++number===1?first.promise:second.promise):undefined;});await tick();
  f.input('[data-image-field="prompt"]','第一张画面');await f.submit();const firstRequest=f.state.calls.find(c=>c.action==='generate');
  // The server has completed the first request, but that original HTTP response
  // is still delayed. A gallery refresh is allowed to confirm it independently.
  f.state.jobs=[{requestId:firstRequest.body.requestId,status:'done',needsReview:false,created:1792970000000}];await f.api.refresh();await tick();
  f.input('[data-image-field="prompt"]','第二张明确的新画面');await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,2);
  first.resolve({job:{status:'done',requestId:firstRequest.body.requestId}});await tick();
  assert.equal(f.document.querySelector('[data-image-generate]').disabled,true,'old completion must not delete the current pending request id');
  await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,2);
  const current=f.state.calls.filter(c=>c.action==='generate')[1];second.resolve({job:{status:'done',requestId:current.body.requestId}});await tick();
});

test('uncertain or interrupted paid requests stay blocked until the same request is confirmed', async t=>{
  for(const mode of ['uncertain','network'])await t.test(mode,async t=>{
    const f=fixture(t,s=>{s.requestImpl=c=>{if(c.action==='generate'){if(mode==='network')throw Error('响应中断');return {job:{status:'uncertain',requestId:c.body.requestId}};}};});await tick();
    f.input('[data-image-field="prompt"]','需要核对的画面');await f.submit();
    const sent=f.state.calls.find(c=>c.action==='generate');assert.equal(f.document.querySelector('[data-image-generate]').disabled,true);
    await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);
    f.state.jobs=[{requestId:'a-different-request',status:'done',needsReview:false,created:1792970000000}];await f.api.refresh();assert.equal(f.document.querySelector('[data-image-generate]').disabled,true,'another task cannot unlock this paid submission');
    f.state.jobs=[{requestId:sent.body.requestId,status:'failed',needsReview:false,created:1792970000000}];await f.api.refresh();assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);
  });
});

test('a fresh controller restores unresolved paid-job protection from server state, including after reload', async t=>{
  for(const status of ['running','uncertain'])await t.test(status,async t=>{
    const f=fixture(t,s=>{s.jobs=[{requestId:'00000000-0000-4000-8000-000000009999',status,needsReview:true,created:1792970000000}];});await tick();
    assert.equal(f.document.querySelector('[data-image-generate]').disabled,true,'a new controller has no previous in-memory request map');
    f.input('[data-image-field="prompt"]','刷新后不应重复提交的画面');await f.submit();assert.equal(f.state.calls.some(c=>c.action==='generate'),false);
    assert.match(f.host.querySelector('[data-image-jobs]').textContent,status==='running'?/生成中/:/结果待核对/);
  });
});

test('an administrator settling the uncertain reservation unlocks new work without inventing an image', async t=>{
  for(const settlement of ['charged','released'])await t.test(settlement,async t=>{
    const requestId='00000000-0000-4000-8000-000000009999';
    const f=fixture(t,s=>{s.jobs=[{requestId,status:'uncertain',needsReview:true,created:1792970000000}];s.items=[];});await tick();
    assert.equal(f.document.querySelector('[data-image-generate]').disabled,true);
    // The image service computes needsReview from the matching quota entry after
    // an authenticated administrator performs charge/release. The browser does
    // not receive or mutate the ledger directly.
    f.state.jobs=[{requestId,status:'uncertain',needsReview:false,created:1792970000000,error:'额度已由管理员核对，图片结果仍待确认（'+settlement+'）'}];
    await f.api.refresh();await tick();
    assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);
    assert.match(f.host.querySelector('[data-image-jobs]').textContent,/结果待核对/);
    assert.equal(f.state.uses.length,0);assert.equal(f.host.querySelector('.image-gallery-card'),null);
    f.input('[data-image-field="prompt"]','明确的新画面');await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,1);
  });
});

test('an explicit rejected request or local reference validation does not lock further edits', async t=>{
  const f=fixture(t,s=>{s.requestImpl=c=>{if(c.action==='generate')throw Object.assign(Error('额度不足，未调用模型'),{rejected:true});};});await tick();
  f.input('[data-image-field="prompt"]','应保留的画面要求');await f.submit();
  assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);assert.equal(f.document.querySelector('[data-image-field="prompt"]').value,'应保留的画面要求');
  await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,2,'the server explicitly rejected both calls before generation');
  f.state.project.assets[0].src='https://not-a-local-reference.example.test/a.png';
  const ref=f.document.querySelector('[data-image-ref]');ref.checked=true;ref.dispatchEvent(new f.window.Event('input',{bubbles:true}));
  await f.submit();assert.equal(f.state.calls.filter(c=>c.action==='generate').length,2);assert.equal(f.document.querySelector('[data-image-generate]').disabled,false);assert.match(f.host.textContent,/参考图不可用/);
});

test('stale DOM actions cannot submit the old draft or old history selection as a new account/project', async t=>{
  for(const mode of ['account','project'])for(const action of ['generate','import','use','input'])await t.test(mode+' '+action,async t=>{
    const f=fixture(t);await tick();f.input('[data-image-field="prompt"]','旧账号尚未提交的要求');await f.uploadBackup(file(backup()));
    f.pick('image-workshop:old-own-image');f.confirm();
    if(mode==='account')f.state.user={id:'user-b'};else f.state.project=project('project-b');
    if(action==='generate')await f.submit();
    if(action==='import')await f.click('[data-image-action="import-selected"]');
    if(action==='use')await f.click('[data-image-action="use"]');
    if(action==='input')f.input('[data-image-field="prompt"]','不应改到新账号');
    assert.equal(f.state.calls.some(c=>['generate','import'].includes(c.action)),false);
    assert.equal(f.state.fetches.length,0);assert.equal(f.state.uses.length,0);
    assert.match(f.host.textContent,/切换|重新打开|重新进入/);
  });
});

test('backup is parsed locally; only an explicit confirmed selection is uploaded, never member/password rows', async t=>{
  const f=fixture(t);await tick();const raw=backup();await f.uploadBackup(file(raw));
  assert.equal(f.state.calls.some(c=>c.action==='import'),false);assert.equal(f.state.fetches.length,0);
  assert.equal(f.document.querySelectorAll('[data-image-import-id]').length,2);
  f.pick('image-workshop:old-own-image');await f.click('[data-image-action="import-selected"]');assert.equal(f.state.calls.some(c=>c.action==='import'),false);
  f.confirm();await f.click('[data-image-action="import-selected"]');
  await waitFor(()=>/已导入 1 张/.test(f.host.textContent),'selected image import completion');
  const imported=f.state.calls.filter(c=>c.action==='import');assert.equal(imported.length,1);assert.equal(imported[0].body.dataUrl,png);assert.equal(imported[0].body.prompt,'保留原提示词');assert.equal(imported[0].body.sourceId,'image-workshop:old-own-image');
  const wire=JSON.stringify(imported[0].body);
  for(const privatePart of ['old-own-user','PRIVATE-PHONE','PRIVATE-PASSWORD-HASH','PRIVATE-ACCESS-TOKEN','UNSELECTED-CREATIVE-TEXT','jingben_members','jingben_images','password_hash'])assert.equal(wire.includes(privatePart),false,privatePart);
  assert.match(f.host.textContent,/已导入 1 张/);
});

test('a scope switch while a selected historical image is uploading stops the remaining batch', async t=>{
  for(const mode of ['account','project'])await t.test(mode,async t=>{
    const gate=deferred();const f=fixture(t,s=>{s.requestImpl=c=>c.action==='import'?gate.promise:undefined;});await tick();
    await f.uploadBackup(file(backup()));f.pick('image-workshop:old-own-image');f.pick('image-workshop:old-unselected');f.confirm();
    await f.click('[data-image-action="import-selected"]');
    await waitFor(()=>f.state.calls.some(c=>c.action==='import'),'first historical image upload');
    assert.equal(f.state.calls.filter(c=>c.action==='import').length,1);
    if(mode==='account')f.state.user={id:'user-b'};else f.state.project=project('project-b');
    f.api.render(f.host);await tick();gate.resolve({item:image('late-import','旧导入结果')});await tick();
    const uploads=f.state.calls.filter(c=>c.action==='import');assert.equal(uploads.length,1);assert.equal(uploads[0].userId,'user-a');assert.equal(uploads[0].body.projectId,'project-a');
    assert.equal(f.document.querySelector('[data-image-import-id]'),null);assert.equal(f.host.textContent.includes('已导入 1 张'),false);assert.equal(f.state.uses.length,0);assert.equal(f.state.project.assets.length,1);
  });
});

test('foreign-owner and ambiguous historical rows remain visible as explicit unimported records', async t=>{
  const f=fixture(t);await tick();const raw=backup();
  raw.data.jingben_images.push(oldRow({id:'foreign',user_id:'other-user',entity_id:'old-char',kind:'front',prompt:'FOREIGN-CREATIVE-SECRET',image_url:png}));
  raw.data.jingben_images.push(oldRow({id:'ambiguous',entity_id:'missing',kind:'reverse',prompt:'AMBIGUOUS-CREATIVE-TEXT',image_url:png}));
  await f.uploadBackup(file(raw));assert.match(f.host.textContent,/归属字段.*不一致/);assert.match(f.host.textContent,/无法确定.*类型/);
  assert.equal(f.host.textContent.includes('FOREIGN-CREATIVE-SECRET'),false);
  assert.equal(f.state.calls.some(c=>c.action==='import'),false);
});

test('remote image failures stay visible and retryable while successful selected images are not selected twice', async t=>{
  const f=fixture(t,s=>{s.fetchImpl=async()=>({ok:false});});await tick();const raw=backup();
  raw.data.jingben_images[1].image_url='https://images.example.test/unavailable.png';
  await f.uploadBackup(file(raw));f.pick('image-workshop:old-own-image');f.pick('image-workshop:old-unselected');f.confirm();await f.click('[data-image-action="import-selected"]');
  await waitFor(()=>/已导入 1 张；未导入 1 张/.test(f.host.textContent),'selected image import settlement');
  assert.equal(f.state.calls.filter(c=>c.action==='import').length,1);assert.match(f.host.textContent,/已导入 1 张；未导入 1 张/);assert.match(f.host.textContent,/原图片地址读取失败/);
  assert.equal(f.pick('image-workshop:old-own-image',false).disabled,true);assert.equal(f.pick('image-workshop:old-unselected',false).disabled,false);
  assert.equal(f.state.fetches.length,1);assert.equal(f.state.fetches[0].options.credentials,'omit');assert.equal(f.state.fetches[0].options.referrerPolicy,'no-referrer');
});

test('a late local backup read cannot expose its preview in another account or project', async t=>{
  for(const mode of ['account','project'])await t.test(mode,async t=>{
    const gate=deferred(),bytes=new TextEncoder().encode(JSON.stringify(backup()));const f=fixture(t);await tick();
    await f.uploadBackup({size:bytes.length,arrayBuffer:()=>gate.promise});
    if(mode==='account')f.state.user={id:'user-b'};else f.state.project=project('project-b');
    f.api.render(f.host);await tick();gate.resolve(bytes.buffer);await tick();
    assert.equal(f.document.querySelector('[data-image-import-id]'),null);assert.equal(f.host.textContent.includes('迁入角色'),false);assert.equal(f.state.calls.some(c=>c.action==='import'),false);
  });
});

test('reference limit and empty prompt validation stop before any paid service request', async t=>{
  const f=fixture(t,s=>{s.project.assets=Array.from({length:4},(_,i)=>({id:'ref-'+i,name:'参考'+i,kind:'image',src:png}));});await tick();
  await f.submit();assert.equal(f.state.calls.some(c=>c.action==='generate'),false);
  f.input('[data-image-field="prompt"]','角色要求');for(const el of f.document.querySelectorAll('[data-image-ref]')){el.checked=true;el.dispatchEvent(new f.window.Event('input',{bubbles:true}));}
  assert.equal(f.document.querySelectorAll('[data-image-ref]:checked').length,3);assert.match(f.host.textContent,/最多选择3张/);
  await f.click('[data-image-action="template"]');assert.match(f.document.querySelector('[data-image-field="prompt"]').value,/参考图/);
});

test('legacy import preserves stable entity slots and copies only selected creative definitions into the current project workspace',async t=>{
 const loadGate=deferred(),saveGate=deferred();
 const f=fixture(t,s=>{s.requestImpl=c=>{if(c.action==='workspace')return c.body?saveGate.promise:loadGate.promise;if(c.action==='slots')return {items:[]};};});await tick();
 await f.uploadBackup(file(backup()));f.pick('image-workshop:old-own-image');f.confirm();await f.click('[data-image-action="import-selected"]');
 await waitFor(()=>f.state.calls.some(c=>c.action==='workspace'&&!c.body),'imported entity workspace read');
 assert.equal(f.state.calls.some(c=>c.action==='workspace'&&c.body),false,'workspace save must wait for its version');
 assert.doesNotMatch(f.host.querySelector('[data-image-message]').textContent,/已导入 1 张/);
 loadGate.resolve({version:0,workspace:{entities:[],style:'',portraitStyle:''}});
 const settings=await waitFor(()=>f.state.calls.find(c=>c.action==='workspace'&&c.body),'imported entity workspace save');
 const imported=f.state.calls.find(c=>c.action==='import');assert.match(imported.body.metadata.entityId,/^legacy-[0-9a-f]{64}$/);assert.equal(imported.body.metadata.slot,'front');assert.equal(imported.body.metadata.entityName,'迁入角色');
 assert.equal(settings.body.projectId,'project-a');assert.equal(settings.body.workspace.entities.length,1);assert.equal(settings.body.workspace.entities[0].id,imported.body.metadata.entityId);
 const serialized=JSON.stringify(settings.body);assert.doesNotMatch(serialized,/PRIVATE-|password_hash|user_id|accessToken/);
 assert.doesNotMatch(f.host.querySelector('[data-image-message]').textContent,/已导入 1 张/);
 saveGate.resolve({version:1,workspace:settings.body.workspace});
 await waitFor(()=>/已导入 1 张/.test(f.host.querySelector('[data-image-message]').textContent),'workspace-backed import completion');
});
