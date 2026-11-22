import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as LC from '../integrations/musecanvas/plugins/line-camera-core.mjs';
import {drawPreview, drawStroke, exportStills, exportVideo} from '../integrations/musecanvas/plugins/line-camera-preview.mjs';
import register from '../integrations/musecanvas/plugins/jubaopeng-line-camera.js';

const saved = route => JSON.parse(LC.serializeRoute(route));
function line() {
  return LC.appendPoint(LC.appendPoint(LC.createRoute(5), {u: .1, v: .2}), {u: .8, v: .7});
}
function memoryStorage(initial = null) {
  const data = new Map();
  if (initial != null) data.set(LC.STORAGE_KEY, initial);
  return {data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value))};
}

test('空路线、单点和越界都不会改掉原来的路线', () => {
  const empty = LC.createRoute(5);
  assert.equal(LC.readiness(empty).code, 'empty');
  assert.equal(LC.samplePose(empty, 1), null);
  assert.throws(() => LC.stillPoses(empty), /起点和终点/);
  const one = LC.appendPoint(empty, {u: .4, v: .6});
  assert.equal(LC.readiness(one).code, 'single');
  assert.equal(LC.samplePose(one, 2).held, true);
  assert.throws(() => LC.stillPoses(one), /一个点/);
  const before = LC.serializeRoute(one);
  assert.throws(() => LC.appendPoint(one, {u: .4, v: .6}), /太近/);
  assert.throws(() => LC.appendPoint(one, {u: 1.2, v: .2}), /超出画面/);
  assert.throws(() => LC.appendPoint(one, {u: .2, v: Number.NaN}), /超出画面/);
  assert.equal(LC.serializeRoute(one), before);
});

test('时长和速度只改时间，反向不改点序，焦距不会被写成别的值', () => {
  const route = line();
  const points = route.imageStroke.points.map(({u, v}) => ({u, v}));
  const longer = LC.setDuration(route, 8);
  assert.equal(longer.duration, 8);
  assert.deepEqual(longer.imageStroke.points.map(({u, v}) => ({u, v})), points);
  assert.ok(Math.abs(LC.travelSpeed(longer) - LC.pathLength(route) / 8) < 1e-9);
  assert.throws(() => LC.setDuration(route, 0), /时长/);
  assert.throws(() => LC.setDuration(route, 90), /时长/);
  assert.equal(route.duration, 5);
  const faster = LC.setSpeed(route, 1);
  assert.deepEqual(faster.imageStroke.points.map(({u, v}) => ({u, v})), points);
  assert.ok(faster.duration !== route.duration);
  assert.throws(() => LC.setSpeed(LC.createRoute(5), 1), /太短/);
  const reversed = LC.reverseDirection(route);
  assert.deepEqual(reversed.imageStroke.points.map(point => point.id), route.imageStroke.points.map(point => point.id));
  const end = route.imageStroke.points.at(-1);
  const startPose = LC.samplePose(reversed, 0);
  assert.ok(Math.abs(startPose.tx - LC.lookAt(end.u, end.v).x) < 1e-9);
  assert.equal(LC.samplePose(route, 0).tx, LC.lookAt(points[0].u, points[0].v).x);
  assert.equal(LC.samplePose(route, 5).tx, LC.lookAt(end.u, end.v).x);
  const lifted = LC.setStandoff(route, 6);
  assert.equal(lifted.camera.standoff, 6);
  assert.ok(Math.abs(LC.samplePose(lifted, 0).z - LC.samplePose(route, 0).z - 2) < 1e-9);
  assert.deepEqual(lifted.imageStroke.points.map(({u, v}) => ({u, v})), points);
  const forced = LC.normalizeRoute({...route, camera: {...route.camera, focal: 85, roll: 20}, modelTrajectory: true, prompt: '推进'});
  assert.equal(forced.camera.focal, 35);
  assert.equal(forced.camera.roll, 0);
  assert.equal(forced.modelTrajectory, undefined);
  assert.equal(forced.prompt, undefined);
  assert.equal(forced.disclaimer, LC.DISCLAIMER);
});

test('暂停不推进时间，播完再播从起点开始', () => {
  const play = LC.createPlayback(line());
  assert.throws(() => LC.createPlayback(LC.createRoute(4)).play(), /路线为空/);
  play.play();
  assert.equal(play.tick(.4).playing, true);
  assert.equal(play.time, .4);
  play.pause();
  assert.equal(play.tick(2).time, .4);
  assert.equal(play.playing, false);
  play.seek(5);
  assert.equal(play.play(), 0);
  assert.equal(play.tick(5).time, 5);
  assert.equal(play.playing, false);
  assert.equal(play.play(), 0);
});

test('路线 JSON 可以重载，虚拟片场数据和坏文件都进不来', () => {
  const route = LC.setDuration(LC.reverseDirection(line()), 9);
  const text = LC.serializeRoute(route);
  const again = LC.parseRoute(text);
  assert.equal(again.duration, 9);
  assert.equal(again.direction, 'reverse');
  assert.deepEqual(again.imageStroke.points, route.imageStroke.points);
  assert.throws(() => LC.parseRoute('{"version":1,"preset":"room"}'), /不是线控运镜/);
  assert.throws(() => LC.parseRoute('{'), /格式/);
  assert.throws(() => LC.parseRoute('x'.repeat(200001)), /200KB/);
  const metadata = LC.embedRoute({title: '保留我', note: '旧字段'}, route);
  assert.equal(metadata.title, '保留我');
  assert.equal(metadata.note, '旧字段');
  assert.equal(LC.extractRoute(metadata).duration, 9);
  assert.equal(LC.extractRoute({title: '没有路线'}), null);
  assert.throws(() => LC.extractRoute({lineCamera: {version: 1}}), /不是线控运镜/);
});

test('手绘保留起终点和转折，过短笔画不生成路线', () => {
  const samples = Array.from({length: 80}, (_, index) => ({u: index / 79, v: index < 40 ? .2 : .8}));
  const drawn = LC.commitStroke(LC.createRoute(6), samples);
  assert.ok(drawn.imageStroke.points.length >= 3 && drawn.imageStroke.points.length <= 48);
  assert.equal(drawn.imageStroke.points[0].u, 0);
  assert.equal(drawn.imageStroke.points.at(-1).u, 1);
  assert.ok(drawn.imageStroke.points.some(point => point.v > .5));
  assert.equal(drawn.duration, 6);
  const before = LC.serializeRoute(drawn);
  assert.throws(() => LC.commitStroke(drawn, [{u: .2, v: .2}]), /太短/);
  assert.throws(() => LC.commitStroke(drawn, [{u: .2, v: .2}, {u: .201, v: .201}]), /太短/);
  assert.equal(LC.serializeRoute(drawn), before);
});

test('预演绘制不依赖生成接口，未就绪的导出在碰画布前就拒绝', async () => {
  const canvas = mockCanvas();
  drawStroke(canvas, line(), null);
  const pose = drawPreview(canvas, line(), 2.5, null);
  assert.equal(pose.held, false);
  assert.ok(pose.z > pose.tz);
  drawPreview(canvas, LC.createRoute(3), 0, null);
  await assert.rejects(() => exportStills(canvas, LC.createRoute(3), null), /起点和终点/);
  await assert.rejects(() => exportVideo(canvas, line(), null), /WebM/);
});

test('插件登记返回节点且不调用生成，boot 只在没有该 id 时启用', () => {
  const calls = {ai: 0, ops: 0};
  const runtime = {
    React: {useEffect() {}, useRef: value => ({current: value})},
    jsx: (type, props) => ({type, props}),
    injectCSS() {}
  };
  const plugin = register(runtime);
  assert.equal(plugin.id, 'jubaopeng-line-camera');
  assert.equal(plugin.version, '1.0.0');
  assert.equal(plugin.nodes[0].type, 'jubaopeng-line-camera');
  assert.equal(typeof plugin.nodes[0].Content, 'function');
  assert.equal(typeof plugin.nodes[0].Panel, 'function');
  assert.equal(typeof plugin.setup(), 'function');
  plugin.setup()();
  const old = {id: 'old-node', metadata: {title: '旧节点'}};
  const ctx = {node: {id: 'node-line-1', metadata: {title: '保留我'}}, ai() { calls.ai += 1; }, applyOps() { calls.ops += 1; }, openPanel() {}, getNodes: () => [old]};
  const card = plugin.nodes[0].Content(ctx);
  assert.match(JSON.stringify(card), /尚未画线/);
  plugin.nodes[0].Panel(ctx);
  assert.deepEqual(calls, {ai: 0, ops: 0});
  assert.equal(old.metadata.title, '旧节点');
  assert.throws(() => register({}), /runtime\.jsx/);
  const fresh = memoryStorage();
  assert.equal(LC.seedLineCameraPlugin(fresh).changed, true);
  assert.deepEqual(JSON.parse(fresh.getItem(LC.STORAGE_KEY))[LC.PLUGIN_ID], {enabled: true, local: true});
  const kept = memoryStorage(JSON.stringify({[LC.PLUGIN_ID]: {enabled: false, local: true}, 'jubaopeng-storyboard': {enabled: true}}));
  const again = LC.seedLineCameraPlugin(kept);
  assert.equal(again.changed, false);
  assert.equal(again.store[LC.PLUGIN_ID].enabled, false);
  assert.equal(again.store['jubaopeng-storyboard'].enabled, true);
  const broken = memoryStorage('{');
  assert.equal(LC.seedLineCameraPlugin(broken).reason, 'invalid-json');
  assert.equal(broken.getItem(LC.STORAGE_KEY), '{');
  const list = memoryStorage(JSON.stringify([{id: 'jubaopeng-storyboard', enabled: true}]));
  assert.equal(LC.seedLineCameraPlugin(list).store.at(-1).id, LC.PLUGIN_ID);
  assert.equal(list.getItem(LC.STORAGE_KEY).includes('jubaopeng-storyboard'), true);
});

test('产物清单里的文件都在，插件源码不覆盖分镜插件', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../integrations/musecanvas/MANIFEST.json', import.meta.url), 'utf8'));
  assert.equal(manifest.replacesMainBundle, false);
  assert.equal(manifest.callsModel, false);
  assert.equal(manifest.id, 'jubaopeng-line-camera');
  for (const file of manifest.files) assert.equal(fs.existsSync(new URL('../' + file, import.meta.url)), true, file);
  for (const file of manifest.copyIntoHostPlugins) {
    const text = fs.readFileSync(new URL('../integrations/musecanvas/plugins/' + file, import.meta.url), 'utf8');
    assert.equal(text.includes('jubaopeng-storyboard'), false, file);
    assert.doesNotMatch(text, /ctx\.ai\s*\(/);
    assert.doesNotMatch(text, /\.ai\s*\(/);
  }
});

function mockCanvas() {
  const context = {};
  for (const name of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'fillText', 'drawImage', 'save', 'restore', 'clip', 'transform']) context[name] = () => {};
  return {width: 640, height: 360, getContext: () => new Proxy(context, {get: (target, key) => key in target ? target[key] : (target[key] = () => {}), set: (target, key, value) => { target[key] = value; return true; }})};
}
