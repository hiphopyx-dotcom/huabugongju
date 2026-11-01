// Real DOM check for the pages/ workbench that /bench exports.
// No live generation, account, database, or provider request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createImageWorkbench} from '../pages/image-workbench.mjs';

let dom;
try { dom = await import('happy-dom'); }
catch { dom = await import(pathToFileURL(process.env.HAPPY_DOM_MODULE || '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href); }
const {Window} = dom;
const tick = async () => {for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));};
const image = (id,slot) => ({id,name:id,kind:'角色',source:'generated',prompt:'原图',ratio:'3:4',resolution:'1k',created:1793000000000,projectId:'project-a',metadata:{entityId:'char-a',entityName:'阿青',slot,episode:'第一集'}});

test('face lock survives reload without being sent to the workspace API, and batch planning still opens', async t => {
  const window = new Window({url:'https://zinc-raven-rocket-drift.grok.me/bench/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  const previous = globalThis.localStorage;
  globalThis.localStorage = window.localStorage;
  const document = window.document;
  document.body.innerHTML = '<main id="host"></main>';
  const host = document.querySelector('#host');
  const state = {
    user:{id:'owner-a'},
    project:{id:'project-a',title:'验收',script:'',settings:{},assets:[],shots:[]},
    workspace:{entities:[{id:'char-a',category:'characters',name:'阿青',episode:'第一集',scope:'episode',fields:{description:'旧青衫',identityRegion:'中国 / 东亚面孔'}}],style:'',portraitStyle:''},
    version:3,
    items:[image('front-canonical','front'),image('side-face','side')],
    calls:[],
    prepared:[],
  };
  const request = async (action, body) => {
    state.calls.push({action, body:body ? structuredClone(body) : undefined});
    if (action==='workspace' && !body) return {workspace:structuredClone(state.workspace), version:state.version};
    if (action==='workspace') {
      state.workspace = structuredClone(body.workspace);
      return {workspace:structuredClone(state.workspace), version:++state.version};
    }
    if (action==='slots') return {items:structuredClone(state.items)};
    throw Error('Unexpected mocked action: '+action);
  };
  const open = () => {
    const api = createImageWorkbench({
      getProject:()=>state.project,
      getUser:()=>state.user,
      request,
      uuid:()=>'00000000-0000-4000-8000-000000000001',
      getStatus:()=>({configured:true,rates:{image:1800},wallet:{available:90000},waiting:false}),
      onPrepare:data=>state.prepared.push(structuredClone(data)),
      onGenerate:async ()=>({job:{status:'done'}}),
    });
    api.render(host);
    return api;
  };
  t.after(async () => {globalThis.localStorage = previous; await window.happyDOM.abort();});
  const click = async selector => {
    const el = host.querySelector(selector);
    assert.ok(el, selector);
    el.click();
    await tick();
  };
  let api = open();
  await click('[data-flow-action="tab"][data-tab="characters"]');
  assert.equal(host.querySelector('[data-flow-action="lock-face"][data-slot="side"]').textContent, '锁定面孔');
  await click('[data-flow-action="lock-face"][data-slot="side"]');
  assert.match(host.textContent, /已锁定面孔 side-face/);
  assert.equal(host.querySelector('[data-flow-action="lock-face"][data-slot="side"]').textContent, '已锁定面孔');
  assert.equal(window.localStorage.getItem('jbp-face-lock:owner-a:project-a'), JSON.stringify({'char-a':'side-face'}));
  await click('[data-flow-action="prepare"][data-slot="expr_smile"]');
  assert.deepEqual(state.prepared.at(-1).libraryRefs, ['side-face']);
  const description = host.querySelector('[data-flow-detail="description"]');
  description.value = '锁脸后仍可保存的描述';
  description.dispatchEvent(new window.Event('input', {bubbles:true}));
  await click('[data-flow-action="save"]');
  const saved = state.calls.find(call => call.action==='workspace' && call.body);
  assert.equal(saved.body.workspace.entities[0].faceLockId, undefined);
  assert.equal(saved.body.workspace.entities[0].fields.description, '锁脸后仍可保存的描述');
  assert.equal(api.getWorkspace().entities[0].faceLockId, 'side-face');
  api.unmount();
  state.prepared.length = 0;
  api = open();
  await click('[data-flow-action="tab"][data-tab="characters"]');
  assert.match(host.textContent, /已锁定面孔 side-face/);
  await click('[data-flow-action="plan-group"]');
  assert.match(host.querySelector('.image-batch-confirm').textContent, /· 9 张/);
  await click('[data-flow-action="clear-face-lock"]');
  assert.equal(host.textContent.includes('已锁定面孔'), false);
  await click('[data-flow-action="prepare"][data-slot="expr_smile"]');
  assert.deepEqual(state.prepared.at(-1).libraryRefs, ['front-canonical']);
  assert.equal(window.localStorage.getItem('jbp-face-lock:owner-a:project-a'), '{}');
});
