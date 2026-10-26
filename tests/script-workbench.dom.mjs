// Optional real-DOM acceptance: node --test tests/script-workbench.dom.mjs
// HAPPY_DOM_MODULE can point to another installed happy-dom/lib/index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createScriptWorkbench} from '../public/studio/script-workbench.mjs';

const {Window} = await import(pathToFileURL(process.env.HAPPY_DOM_MODULE || '/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const project = (id = 'project-a') => ({id, title: '同一部作品', script: '第1集\n1-1 日 内 门房\n△拆信。\n陈默：空白。\n\n第2集\n2-1 夜 外 巷口\n△来人转身。', settings: {}, story: {}, shots: [], assets: []});

function fixture() {
  const window = new Window({url: 'https://jubaopeng-canvas.vercel.app/studio/index.html', settings: {disableIframePageLoading: true, disableJavaScriptFileLoading: true}});
  const document = window.document;
  document.body.innerHTML = '<main id="host"></main><div id="modal"><div id="modalBody"></div></div>';
  const state = {project: project(), user: {id: 'user-a'}, saves: 0, changes: 0, flushes: 0, imports: [], toasts: [], mounts: [], locals: 0, ai: 0, destinations: [], downloads: []};
  const host = document.querySelector('#host');
  const writer = {unmount() {}, async mount(node, options = {}) {state.mounts.push(options); node.innerHTML = '<div data-writer-ready>候选稿区域</div>';}};
  const api = createScriptWorkbench({document, window, getProject: () => state.project, getUser: () => state.user,
    change: fn => {state.changes++; fn();}, save: () => {state.saves++;},
    flush: async () => {state.flushes++; if (state.flushImpl) await state.flushImpl();}, writer,
    toast: value => state.toasts.push(value),
    openModal: html => {document.querySelector('#modal').style.display = 'flex'; document.querySelector('#modalBody').innerHTML = html;},
    closeModal: () => {document.querySelector('#modal').style.display = 'none'; document.querySelector('#modalBody').innerHTML = '';},
    importProject: async (data, expected) => {state.imports.push({data, expected});},
    breakdown: {local: () => {state.locals++;}, aiSetup: () => {state.ai++;}},
    goto: value => state.destinations.push(value), download: kind => {state.downloads.push({kind, projectId: state.project.id, userId: state.user?.id, script: state.project.script});},
  });
  api.render(host);
  const click = async selector => {const el = document.querySelector(selector); assert.ok(el, selector); el.click(); await tick(); return el;};
  const input = (selector, value) => {const el = document.querySelector(selector); assert.ok(el, selector); el.value = value; el.dispatchEvent(new window.Event('input', {bubbles: true})); return el;};
  const bridge = async () => {
    await click('[data-work="import"]'); await click('[data-import="library"]');
    const frame = document.querySelector('iframe');
    const nonce = new URL(frame.src).searchParams.get('nonce');
    return {frame, nonce, send(bundle, overrides = {}) {
      window.dispatchEvent(new window.MessageEvent('message', {origin: window.location.origin, source: frame.contentWindow,
        data: {type: 'jbp-project-import', nonce, bundle}, ...overrides}));
    }};
  };
  return {window, document, state, host, api, click, input, bridge};
}

const oldWork = () => ({project: {id: 'old-id', ownerId: 'old-owner', title: '旧作品', premise: '保留梗概', episodeCount: 40},
  characters: [{name: '陈默', notes: '保留小传'}], episodes: [{number: 1, title: '拆信', content: '第1集 拆信\n1-1 日 内 门房\n△拆信。'}]});

test('setup, inline writing and manuscript share one project and persist continued typing', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  f.input('[data-story="premise"]', '第一笔梗概');
  f.input('[data-story="premise"]', '完整梗概');
  assert.equal(f.state.project.story.premise, '完整梗概');
  assert.equal(f.state.changes, 1, 'same typing session creates only one undo checkpoint');
  assert.equal(f.state.saves, 1, 'continued typing queues another save');
  await f.click('[data-work="create"]');
  assert.ok(f.document.querySelector('[data-writer-ready]'));
  assert.equal(f.state.mounts.length, 1);
  await f.click('[data-work="step"][data-step="manuscript"]');
  f.input('[data-work-script]', '第1集\n1-1 日 内 门房\n△手改正文。');
  await f.click('[data-work="step"][data-step="setup"]');
  assert.equal(f.document.querySelector('[data-story="premise"]').value, '完整梗概');
  await f.click('[data-work="step"][data-step="manuscript"]');
  assert.match(f.document.querySelector('[data-work-script]').value, /手改正文/);
  assert.equal(f.state.project.id, 'project-a');
  assert.deepEqual(f.state.imports, []);
});

test('episode and review buttons locate the corresponding manuscript text', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  await f.click('[data-work="step"][data-step="manuscript"]');
  await f.click('[data-work="episode"][data-key="第2集#1"]');
  let editor = f.document.querySelector('[data-work-script]');
  assert.match(editor.value.slice(editor.selectionStart, editor.selectionEnd), /^第2集/);
  f.state.project.script = '第1集\r\n1-1 日 内 门房\r\n△动作。\r\n陈默：\r\n';
  await f.click('[data-work="step"][data-step="review"]');
  await f.click('[data-work="line"][data-line="4"]');
  editor = f.document.querySelector('[data-work-script]');
  assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), '陈默：');
});

test('the manuscript DOCX button exports the latest typed text and displays its fixed format', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  await f.click('[data-work="step"][data-step="manuscript"]');
  assert.equal(f.document.querySelector('[data-work="export"]').textContent, '导出 DOCX');
  assert.match(f.host.textContent, /Word 导出固定为宋体、小四、1\.5 倍行距/);
  f.input('[data-work-script]', '第1集\n1-1 日 内 门房\n△手改尚未定稿。');
  const latest = '第1集\n1-1 日 内 门房\n△手改后的最新正文。\n陈默：这一版才导出。\n\n';
  f.input('[data-work-script]', latest);
  await f.click('[data-work="export"]');
  assert.deepEqual(f.state.downloads, [{kind: 'script', projectId: 'project-a', userId: 'user-a', script: latest}]);
  assert.equal(f.state.project.script, latest);
  assert.equal(f.document.querySelector('[data-work-script]').value, latest);
  assert.equal(f.state.imports.length, 0);
});

test('a stale manuscript page cannot export after a project or account switch', async t => {
  for (const scope of ['project', 'account']) await t.test(scope, async t => {
    const f = fixture(); t.after(() => f.window.happyDOM.abort());
    await f.click('[data-work="step"][data-step="manuscript"]');
    f.input('[data-work-script]', '第1集\n△旧页面的正文。');
    if (scope === 'project') f.state.project = {...project('project-b'), script: '第1集\n△新作品的正文。'};
    else f.state.user = {id: 'user-b'};
    const current = f.state.project.script;
    await f.click('[data-work="export"]');
    assert.deepEqual(f.state.downloads, []);
    assert.equal(f.state.project.script, current);
    assert.ok(f.state.toasts.some(message => /项目或账号已切换/.test(message)));
    f.api.render(f.host);
    await f.click('[data-work="step"][data-step="manuscript"]');
    await f.click('[data-work="export"]');
    assert.deepEqual(f.state.downloads, [{kind: 'script', projectId: f.state.project.id, userId: f.state.user.id, script: current}]);
  });
});

test('bridge requires launcher origin, exact iframe source and nonce, and previews before confirmation', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  const b = await f.bridge();
  assert.ok(b.nonce);
  b.send(oldWork(), {origin: 'https://untrusted.example'});
  b.send(oldWork(), {source: f.window});
  b.send(oldWork(), {data: {type: 'jbp-project-import', nonce: 'wrong-nonce', bundle: oldWork()}});
  assert.equal(f.document.querySelector('[data-import="confirm"]'), null);
  b.send(oldWork());
  assert.ok(f.document.querySelector('[data-import="confirm"]'));
  assert.equal(f.state.imports.length, 0, 'a bridge response must never create a project by itself');
  assert.equal(f.state.project.title, '同一部作品');
  await f.click('[data-import="confirm"]');
  assert.equal(f.state.imports.length, 1);
  assert.equal(f.state.imports[0].expected, 'user-a:project-a');
  assert.equal(f.state.imports[0].data.title, '旧作品');
  assert.equal(JSON.stringify(f.state.imports[0].data).includes('old-owner'), false);
  assert.equal(f.state.project.title, '同一部作品', 'the workbench delegates creation and does not overwrite the current work');
  b.send(oldWork());
  assert.equal(f.state.imports.length, 1, 'the completed bridge is removed');
});

test('account changes reject old input, bridge response and import confirmation', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  const b = await f.bridge();
  b.send(oldWork());
  f.state.user = {id: 'user-b'};
  f.input('[data-story="premise"]', '不能串到新账号');
  assert.equal(f.state.project.story.premise, undefined);
  b.send(oldWork());
  assert.match(f.document.querySelector('[data-import-error]').textContent, /账号已切换/);
  await f.click('[data-import="confirm"]');
  assert.equal(f.state.imports.length, 0);
  assert.match(f.document.querySelector('[data-import-error]').textContent, /账号已切换/);
});

test('a project switch during save prevents the previous page from starting breakdown in the new project', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  let release;
  f.state.flushImpl = () => new Promise(resolve => {release = resolve;});
  await f.click('[data-work="step"][data-step="shots"]');
  await f.click('[data-work="local"]');
  assert.equal(f.state.flushes, 1);
  f.state.project = project('project-b');
  f.api.render(f.host);
  release(); await tick();
  assert.equal(f.state.locals, 0);
  assert.ok(f.state.toasts.some(message => /项目或账号已切换/.test(message)));
});

test('canvas V2 round trip retains a saved model review report', async t => {
  const f = fixture(); t.after(() => f.window.happyDOM.abort());
  f.state.project.story.reviewReport = '第1集：请核对人物动机。';
  await f.click('[data-work="step"][data-step="review"]');
  assert.equal(f.document.querySelector('textarea[aria-label="模型诊断报告"]').value, f.state.project.story.reviewReport);
  const {normalizeWorkshopImport} = await import('../public/studio/story-workshop-core.mjs');
  const restored = normalizeWorkshopImport({...f.state.project, version: 2});
  assert.equal(restored.story.reviewReport, f.state.project.story.reviewReport);
});
