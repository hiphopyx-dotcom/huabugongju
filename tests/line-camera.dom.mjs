import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {mountLineCamera} from '../integrations/musecanvas/plugins/line-camera-editor.mjs';
import {createRoute, serializeRoute, appendPoint} from '../integrations/musecanvas/plugins/line-camera-core.mjs';
import register from '../integrations/musecanvas/plugins/jubaopeng-line-camera.js';

let dom;
try { dom = await import('happy-dom'); }
catch { dom = await import(pathToFileURL('/tmp/jbp-writing-dom/node_modules/happy-dom/lib/index.js').href); }
const {Window} = dom;

function page() {
  const window = new Window({url: 'http://localhost/harness/', settings: {disableJavaScriptFileLoading: true, disableCSSFileLoading: true}});
  const document = window.document;
  const queued = [];
  window.requestAnimationFrame = fn => { queued.push(fn); return queued.length; };
  window.cancelAnimationFrame = id => { queued[id - 1] = null; };
  document.body.innerHTML = '<div id="host"></div><div id="card"></div><div id="panel"></div>';
  return {window, document, host: document.querySelector('#host'), queued};
}

function click(host, selector) {
  const el = host.querySelector(selector);
  assert.ok(el, selector);
  el.click();
  return el;
}

function point(canvas, u, v) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.width;
  const height = rect.height || canvas.height;
  canvas.dispatchEvent(new canvas.ownerDocument.defaultView.PointerEvent('pointerdown', {clientX: rect.left + u * width, clientY: rect.top + v * height, button: 0, bubbles: true}));
}

test('面板可以画点、改时长、暂停重放、保存后重开，并拒绝空路线导出', async () => {
  const {window, host, queued} = page();
  const saved = [];
  const handle = mountLineCamera(host, {bindingLabel: '节点 node-line-1', onSave: route => saved.push(route)});
  assert.match(host.textContent, /图像平面画线/);
  assert.match(host.textContent, /不是生成模型轨迹/);
  click(host, '[data-lc="export-stills"]');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(host.querySelector('[data-lc="status"]').textContent, /路线为空/);
  click(host, '[data-lc="play"]');
  assert.match(host.querySelector('[data-lc="status"]').textContent, /路线为空/);
  click(host, '[data-lc="mode-points"]');
  const canvas = host.querySelector('[data-lc="stroke"]');
  point(canvas, .2, .3);
  assert.match(host.querySelector('[data-lc="summary"]').textContent, /1 点/);
  click(host, '[data-lc="export-stills"]');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(host.querySelector('[data-lc="status"]').textContent, /只有一个点/);
  point(canvas, .75, .6);
  assert.match(host.querySelector('[data-lc="summary"]').textContent, /2 点/);
  const duration = host.querySelector('[data-lc="duration"]');
  duration.value = '0';
  duration.dispatchEvent(new window.Event('change', {bubbles: true}));
  assert.match(host.querySelector('[data-lc="status"]').textContent, /时长/);
  assert.equal(handle.getRoute().duration, 5);
  duration.value = '8';
  duration.dispatchEvent(new window.Event('change', {bubbles: true}));
  assert.equal(handle.getRoute().duration, 8);
  assert.deepEqual(handle.getRoute().imageStroke.points.map(({u, v}) => [u, v]), [[.2, .3], [.75, .6]]);
  click(host, '[data-lc="play"]');
  assert.equal(handle.isPlaying(), true);
  const started = queued.filter(Boolean).at(-1);
  started(window.performance.now() + 500);
  const mid = handle.getTime();
  assert.ok(mid > 0 && mid < 8);
  click(host, '[data-lc="play"]');
  assert.equal(handle.isPlaying(), false);
  const paused = handle.getTime();
  const late = queued.filter(Boolean).at(-1);
  if (late && late !== started) late(window.performance.now() + 900);
  assert.equal(handle.getTime(), paused);
  host.querySelector('[data-lc="scrub"]').value = '8';
  host.querySelector('[data-lc="scrub"]').dispatchEvent(new window.Event('input', {bubbles: true}));
  click(host, '[data-lc="play"]');
  assert.equal(handle.getTime(), 0);
  click(host, '[data-lc="save"]');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].imageStroke.points.length, 2);
  handle.destroy();
  handle.destroy();
  assert.equal(host.querySelector('[data-lc="root"]'), null);
  const reopened = mountLineCamera(host, {route: saved[0]});
  assert.equal(reopened.getRoute().duration, 8);
  assert.equal(reopened.getRoute().imageStroke.points.length, 2);
  const text = await reopened.exportJSON();
  reopened.importText(text);
  assert.equal(reopened.getRoute().imageStroke.points[0].u, saved[0].imageStroke.points[0].u);
  reopened.destroy();
  await window.happyDOM.abort();
});

test('插件面板挂上编辑器，保存只写 lineCamera，不调用生成', async () => {
  const {window, document, queued} = page();
  const calls = {ai: 0, ops: 0};
  const node = {id: 'node-line-1', metadata: {title: '保留我', note: '旧字段'}};
  const other = {id: 'old-node', metadata: {title: '旧节点'}};
  let hooks = [];
  let index = 0;
  let pending = [];
  const runtime = {
    React: {
      useRef(value) { const slot = hooks[index] || (hooks[index] = {current: value}); index += 1; return slot; },
      useEffect(fn) { pending.push(fn); }
    },
    jsx: (type, props) => ({type, props: props || {}}),
    injectCSS() {}
  };
  const plugin = register(runtime);
  const ctx = {
    node,
    updateMetadata(patch) { node.metadata = {...node.metadata, ...patch}; },
    getUpstream() { return []; },
    getNodes: () => [node, other],
    applyOps() { calls.ops += 1; },
    ai() { calls.ai += 1; }
  };
  const card = plugin.nodes[0].Content(ctx);
  const cardHost = document.querySelector('#card');
  render(card, cardHost);
  assert.match(cardHost.textContent, /尚未画线/);
  index = 0;
  const panel = plugin.nodes[0].Panel(ctx);
  const panelHost = document.querySelector('#panel');
  render(panel, panelHost);
  const cleanups = pending.splice(0).map(fn => fn()).filter(fn => typeof fn === 'function');
  const root = panelHost.querySelector('[data-lc="root"]');
  assert.ok(root);
  click(root, '[data-lc="mode-points"]');
  point(root.querySelector('[data-lc="stroke"]'), .15, .2);
  point(root.querySelector('[data-lc="stroke"]'), .7, .8);
  click(root, '[data-lc="save"]');
  assert.equal(node.metadata.title, '保留我');
  assert.equal(node.metadata.note, '旧字段');
  assert.equal(node.metadata.lineCamera.imageStroke.points.length, 2);
  assert.equal(other.metadata.title, '旧节点');
  assert.deepEqual(calls, {ai: 0, ops: 0});
  assert.equal(queued.length >= 0, true);
  cleanups.forEach(fn => fn());
  assert.equal(panelHost.querySelector('[data-lc="root"]'), null);
  const invalid = mountLineCamera(document.querySelector('#host'), {notice: '坏数据未覆盖'});
  assert.match(document.querySelector('#host').textContent, /坏数据未覆盖/);
  assert.equal(invalid.getRoute().kind, createRoute().kind);
  invalid.destroy();
  assert.doesNotThrow(() => serializeRoute(appendPoint(appendPoint(createRoute(3), {u: .1, v: .1}), {u: .2, v: .4})));
  await window.happyDOM.abort();
});

function render(vnode, parent) {
  if (vnode == null || vnode === false) return;
  if (Array.isArray(vnode)) { vnode.forEach(child => render(child, parent)); return; }
  if (typeof vnode !== 'object') { parent.appendChild(parent.ownerDocument.createTextNode(String(vnode))); return; }
  const el = parent.ownerDocument.createElement(vnode.type);
  const props = vnode.props || {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'ref' || value == null) continue;
    if (key === 'className') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  if (props.ref) props.ref.current = el;
  const children = Array.isArray(props.children) ? props.children : props.children != null ? [props.children] : [];
  children.forEach(child => render(child, el));
  parent.appendChild(el);
}
