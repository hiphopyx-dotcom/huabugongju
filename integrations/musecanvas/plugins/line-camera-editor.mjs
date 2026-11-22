// DOM editor with an explicit mount/destroy pair. It does not touch the host
// bundle, localStorage, or any generation API.
import {appendPoint, clearPoints, commitStroke, createRoute, DISCLAIMER, extractRoute, movePoint, nearestPoint, normalizeRoute, parseRoute, readiness, reverseDirection, serializeRoute, setDuration, setSpeed, setStandoff, travelSpeed} from './line-camera-core.mjs';
import {drawPreview, drawStroke, exportStills, exportVideo} from './line-camera-preview.mjs';

export const EDITOR_CSS = `
.jbp-lc{font:14px/1.45 "Segoe UI",sans-serif;color:#1c2836;background:#f4f7fb;border:1px solid #c5d0dc;border-radius:12px;padding:14px;display:grid;gap:12px}
.jbp-lc h2,.jbp-lc h3{margin:0}
.jbp-lc h2{font-size:18px}
.jbp-lc h3{font-size:14px}
.jbp-lc p{margin:0}
.jbp-lc-note{color:#3e5166;background:#e7eef6;border-radius:8px;padding:8px 10px}
.jbp-lc-warn{color:#6a3b12;background:#fff3df;border-radius:8px;padding:8px 10px}
.jbp-lc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.jbp-lc canvas{width:100%;height:auto;background:#efe8dc;border:1px solid #b7c3d0;border-radius:8px;touch-action:none;cursor:crosshair}
.jbp-lc-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.jbp-lc button,.jbp-lc label{font:inherit}
.jbp-lc button{border:1px solid #9aabbd;background:#fff;border-radius:7px;padding:6px 10px;color:#1c2836}
.jbp-lc button[aria-pressed="true"]{background:#1f6f4a;color:#fff;border-color:#1f6f4a}
.jbp-lc button.primary{background:#1d4e89;color:#fff;border-color:#1d4e89}
.jbp-lc input[type="number"],.jbp-lc input[type="range"]{accent-color:#1d4e89}
.jbp-lc input[type="number"]{width:5.5rem}
.jbp-lc-status{min-height:1.4em;color:#1d4e89}
.jbp-lc-card{font:13px/1.4 sans-serif;display:grid;gap:4px;padding:8px;border:1px solid #c5ced8;border-radius:8px;background:#f7f8fa;color:#1d2733;max-width:240px}
.jbp-lc-card small{color:#5c6b7a}
.jbp-lc-card button{justify-self:start}
`;

export function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('jubaopeng-line-camera-style')) return;
  const style = doc.createElement('style');
  style.id = 'jubaopeng-line-camera-style';
  style.textContent = EDITOR_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

function loadImage(src, doc) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const ImageRef = doc.defaultView?.Image || globalThis.Image;
    const image = new ImageRef();
    const timer = setTimeout(() => resolve(null), 1500);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = src;
  });
}

function download(doc, blob, name) {
  const url = doc.defaultView.URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 1000);
}

export function mountLineCamera(host, options = {}) {
  if (!host || typeof host.appendChild !== 'function') throw Error('缺少挂载节点');
  const doc = host.ownerDocument;
  ensureStyle(doc);
  let alive = true;
  let route = options.route ? normalizeRoute(options.route) : createRoute(options.duration || 5);
  let image = null;
  let mode = 'draw';
  let draft = null;
  let dragId = null;
  let undo = [];
  let raf = 0;
  let lastTick = 0;
  let playing = false;
  let time = 0;
  let recording = false;
  const view = doc.defaultView || globalThis;
  const requestFrame = view.requestAnimationFrame?.bind(view) || requestAnimationFrame;
  const cancelFrame = view.cancelAnimationFrame?.bind(view) || cancelAnimationFrame;

  host.classList.add('jbp-lc-host');
  host.innerHTML = `<section class="jbp-lc" data-lc="root" role="region" aria-label="线控运镜">
    <header><h2>线控运镜</h2><p data-lc="binding"></p><p class="jbp-lc-note" data-lc="disclaimer"></p><p class="jbp-lc-warn" data-lc="notice" hidden></p></header>
    <div class="jbp-lc-grid">
      <div><h3>图像平面画线（2D）</h3><p>在参考图上画路径。绿色是起点，红色是终点，箭头是行进方向。这不是摄影机坐标。</p><canvas data-lc="stroke" width="640" height="360"></canvas>
        <div class="jbp-lc-row"><button type="button" data-lc="mode-draw" aria-pressed="true">手绘</button><button type="button" data-lc="mode-points">加点</button><button type="button" data-lc="mode-edit">拖点</button><button type="button" data-lc="undo">撤销</button><button type="button" data-lc="clear">清空</button><button type="button" data-lc="reverse">反向</button></div></div>
      <div><h3>白模机位预演（3D）</h3><p>画面直立在白模房间里，机位在笔画对应点的正前方。这是几何换算，不是生成模型轨迹。</p><canvas data-lc="preview" width="640" height="360"></canvas>
        <div class="jbp-lc-row"><button type="button" data-lc="play">播放</button><input data-lc="scrub" type="range" min="0" max="5" step="0.01" value="0" aria-label="预演时间"><span data-lc="time"></span></div></div>
    </div>
    <div class="jbp-lc-row"><label>时长（秒）<input data-lc="duration" type="number" min="1" max="60" step="0.1"></label><label>速度（米/秒）<input data-lc="speed" type="number" min="0.05" max="20" step="0.01"></label><label>机位离画面（米）<input data-lc="standoff" type="number" min="1" max="12" step="0.1"></label><strong data-lc="summary"></strong></div>
    <div class="jbp-lc-row"><button type="button" class="primary" data-lc="save">保存路线</button><button type="button" data-lc="export-json">下载路线 JSON</button><button type="button" data-lc="export-stills">导出静帧 PNG</button><button type="button" data-lc="export-video">导出白模 WebM</button><label>导入路线 JSON <input data-lc="import" type="file" accept="application/json,.json"></label></div>
    <p class="jbp-lc-status" data-lc="status" role="status"></p>
  </section>`;

  const root = host.querySelector('[data-lc="root"]');
  const q = name => root.querySelector(`[data-lc="${name}"]`);
  const stroke = q('stroke');
  const preview = q('preview');
  q('binding').textContent = options.bindingLabel || '独立编辑器';
  q('disclaimer').textContent = DISCLAIMER;
  if (options.notice) { const note = q('notice'); note.hidden = false; note.textContent = options.notice; }

  function status(message) { if (alive) q('status').textContent = message || ''; }
  function stopPlayback() { playing = false; cancelFrame(raf); q('play').textContent = '播放'; }
  function remember() { undo.push(serializeRoute(route)); if (undo.length > 30) undo.shift(); }
  function adopt(next, message) {
    route = normalizeRoute(next);
    if (time > route.duration) time = route.duration;
    paint();
    if (message) status(message);
  }
  function paint() {
    if (!alive) return;
    try { drawStroke(stroke, route, image, draft); } catch (error) { status('图像平面未能绘制：' + error.message); }
    try { drawPreview(preview, route, time, image); } catch (error) { status('白模预演未能绘制：' + error.message); }
    const ready = readiness(route);
    const speed = travelSpeed(route);
    q('summary').textContent = `${route.imageStroke.points.length} 点 · ${route.duration.toFixed(2)} 秒 · ${speed ? speed.toFixed(2) : '—'} 米/秒 · ${route.direction === 'reverse' ? '反向' : '正向'} · ${ready.message}`;
    q('time').textContent = `${time.toFixed(2)} / ${route.duration.toFixed(2)} 秒`;
    q('scrub').max = String(route.duration);
    q('scrub').value = String(time);
    for (const [name, input] of [['duration', route.duration], ['speed', speed || ''], ['standoff', route.camera.standoff]]) {
      const el = q(name);
      if (doc.activeElement !== el) el.value = input === '' ? '' : String(roundInput(input));
    }
    q('play').textContent = playing ? '暂停' : '播放';
    for (const name of ['draw', 'points', 'edit']) q('mode-' + name).setAttribute('aria-pressed', mode === name ? 'true' : 'false');
  }
  function roundInput(value) { return Math.round(Number(value) * 100) / 100; }
  function fail(error) { status(error.message); }

  function uv(event) {
    const rect = stroke.getBoundingClientRect();
    const width = rect.width || stroke.width;
    const height = rect.height || stroke.height;
    return {
      u: Math.max(0, Math.min(1, (event.clientX - rect.left) / width)),
      v: Math.max(0, Math.min(1, (event.clientY - rect.top) / height))
    };
  }

  function loop(now) {
    if (!alive || !playing) return;
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    time = Math.min(route.duration, time + dt);
    if (time >= route.duration - 1e-4) { time = route.duration; stopPlayback(); }
    paint();
    if (playing) raf = requestFrame(loop);
  }

  stroke.addEventListener('pointerdown', event => {
    if (!alive || event.button !== 0) return;
    stopPlayback();
    const point = uv(event);
    if (mode === 'points') {
      try { remember(); adopt(appendPoint(route, point), '已添加图像点'); } catch (error) { undo.pop(); fail(error); }
      return;
    }
    if (mode === 'edit') {
      const hit = nearestPoint(route, point);
      if (!hit) { status('附近没有路线点'); return; }
      remember();
      dragId = hit.id;
      stroke.setPointerCapture?.(event.pointerId);
      return;
    }
    draft = [point];
    stroke.setPointerCapture?.(event.pointerId);
    paint();
  });
  stroke.addEventListener('pointermove', event => {
    if (!alive) return;
    const point = uv(event);
    if (mode === 'draw' && draft) {
      const last = draft.at(-1);
      if (Math.hypot(point.u - last.u, point.v - last.v) >= 0.004) draft.push(point);
      paint();
    } else if (mode === 'edit' && dragId) {
      try { route = movePoint(route, dragId, point); paint(); } catch { /* keep the last valid position while dragging */ }
    }
  });
  function finishPointer() {
    if (mode === 'draw' && draft) {
      const samples = draft;
      draft = null;
      try { remember(); adopt(commitStroke(route, samples), '手绘已变成可编辑的图像路线'); }
      catch (error) { undo.pop(); paint(); fail(error); status(error.message + '，已保留原路线'); }
    }
    dragId = null;
  }
  stroke.addEventListener('pointerup', finishPointer);
  stroke.addEventListener('pointercancel', () => { draft = null; dragId = null; paint(); status('绘制已取消，原路线还在'); });

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !alive) return;
    const action = button.dataset.lc;
    try {
      if (action?.startsWith('mode-')) { mode = action.slice(5); draft = null; dragId = null; paint(); return; }
      if (action === 'undo') {
        const previous = undo.pop();
        if (!previous) return status('没有可撤销的修改');
        adopt(parseRoute(previous), '已撤销一步');
        return;
      }
      if (action === 'clear') { remember(); adopt(clearPoints(route), '图像路线已清空'); return; }
      if (action === 'reverse') {
        const next = reverseDirection(route);
        remember();
        adopt(next, next.direction === 'reverse' ? '行进方向已反向' : '行进方向已改回正向');
        return;
      }
      if (action === 'play') {
        const ready = readiness(route);
        if (playing) { stopPlayback(); paint(); status('已暂停'); return; }
        if (!ready.ok) { status(ready.message); return; }
        if (time >= route.duration - 1e-4) time = 0;
        playing = true;
        lastTick = view.performance.now();
        paint();
        raf = requestFrame(loop);
        status('正在预演白模机位');
        return;
      }
      if (action === 'save') {
        const saved = normalizeRoute(route);
        await options.onSave?.(saved);
        status('路线已保存。重开面板会读取这份数据。');
        return;
      }
      if (action === 'export-json') {
        const text = serializeRoute(route);
        download(doc, new Blob([text], {type: 'application/json'}), '线控运镜-路线.json');
        options.onArtifact?.({kind: 'json', text, route: parseRoute(text)});
        status('已下载路线 JSON，可用导入恢复');
        return;
      }
      if (action === 'export-stills') {
        const frames = await exportStills(preview, route, image);
        for (const frame of frames) download(doc, frame.blob, frame.name);
        options.onArtifact?.({kind: 'stills', frames});
        status('已导出首、中、尾三张白模静帧');
        return;
      }
      if (action === 'export-video') {
        if (recording) return;
        recording = true;
        status('正在导出白模预演…');
        try {
          const blob = await exportVideo(preview, route, image, {cancelled: () => !alive});
          if (!alive) return;
          download(doc, blob, '线控运镜-白模预演.webm');
          options.onArtifact?.({kind: 'video', blob});
          status('已导出白模 WebM。它是本地几何预演，不是生成成片。');
        } finally { recording = false; paint(); }
      }
    } catch (error) { fail(error); }
  });

  q('scrub').addEventListener('input', () => {
    stopPlayback();
    time = Number(q('scrub').value);
    paint();
  });
  q('duration').addEventListener('change', () => {
    try { remember(); adopt(setDuration(route, q('duration').value), '时长已更新，图像路线没有移动'); }
    catch (error) { undo.pop(); paint(); fail(error); }
  });
  q('speed').addEventListener('change', () => {
    try { remember(); adopt(setSpeed(route, q('speed').value), '已按速度重算时长，图像路线没有移动'); }
    catch (error) { undo.pop(); paint(); fail(error); }
  });
  q('standoff').addEventListener('change', () => {
    try { remember(); adopt(setStandoff(route, q('standoff').value), '机位距离已更新。图像笔画不变，三维距离变了。'); }
    catch (error) { undo.pop(); paint(); fail(error); }
  });
  q('import').addEventListener('change', async () => {
    const file = q('import').files?.[0];
    q('import').value = '';
    if (!file) return;
    try {
      const next = parseRoute(await file.text());
      remember();
      adopt(next, '已导入路线，点击保存路线后才会写入节点');
    } catch (error) { fail(error); }
  });

  const ready = loadImage(options.imageSrc || '', doc).then(loaded => { image = loaded; if (alive) paint(); return image; });
  paint();

  return {
    ready,
    destroy() {
      if (!alive) return;
      alive = false;
      stopPlayback();
      host.replaceChildren();
      host.classList.remove('jbp-lc-host');
    },
    getRoute() { return normalizeRoute(route); },
    getTime() { return time; },
    isPlaying() { return playing; },
    async exportJSON() { return serializeRoute(route); },
    async exportStills() { return exportStills(preview, route, image); },
    importText(text) { const next = parseRoute(text); remember(); adopt(next, '已导入路线'); return getRouteSafe(); }
  };
  function getRouteSafe() { return normalizeRoute(route); }
}

export function readInitialRoute(metadata) {
  try { return {route: extractRoute(metadata), invalid: false}; }
  catch { return {route: null, invalid: true}; }
}
