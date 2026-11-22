// Line-camera route core. No rendering, network, storage, or model calls.
// A 2D image stroke is not a camera pose. The 3D pose is a fixed geometric lift.

export const PLUGIN_ID = 'jubaopeng-line-camera';
export const STORAGE_KEY = 'infinite-canvas:plugin_store';
export const LIFT = 'board-normal-standoff';
export const DISCLAIMER = '图像上的线是平面笔画，不是摄影机坐标。白模机位把每个笔画点投到直立画面上，摄影机放在该点正前方的固定距离处并沿路程匀速移动。这是本地几何换算，不是生成模型轨迹，也不会发起生成。';

export const BOARD = Object.freeze({width: 6, height: 3.375, z: -3, baseY: 0.7});
export const LIMITS = Object.freeze({
  maxPoints: 48,
  minDuration: 1,
  maxDuration: 60,
  minStandoff: 1,
  maxStandoff: 12,
  minSpeed: 0.05,
  maxSpeed: 20,
  minGap: 0.008,
  focal: 35,
  maxJson: 200000
});

const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const round = value => Math.round(value * 10000) / 10000;
const round2 = value => Math.round(value * 100) / 100;

function pointId(id) {
  if (typeof id === 'string' && /^p[0-9a-f]{12}$/.test(id)) return id;
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'p' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanPoint(point) {
  const u = round(Number(point?.u));
  const v = round(Number(point?.v));
  if (!finite(u, 0, 1) || !finite(v, 0, 1)) throw Error('图像笔画超出画面');
  return {id: pointId(point?.id), u, v};
}

function assertGaps(points) {
  const ids = new Set();
  for (let i = 0; i < points.length; i++) {
    if (ids.has(points[i].id)) throw Error('路线点标识重复');
    ids.add(points[i].id);
    if (i && Math.hypot(points[i].u - points[i - 1].u, points[i].v - points[i - 1].v) < LIMITS.minGap) {
      throw Error('相邻路线点太近');
    }
  }
}

export function createRoute(duration = 5) {
  const value = Number(duration);
  return normalizeRoute({
    version: 1,
    kind: 'line-camera',
    imageStroke: {space: 'image-plane-2d', points: []},
    camera: {space: 'white-box-3d', lift: LIFT, standoff: 4, focal: LIMITS.focal, roll: 0},
    direction: 'forward',
    duration: finite(value, LIMITS.minDuration, LIMITS.maxDuration) ? value : 5
  });
}

export function normalizeRoute(input) {
  if (!input || input.version !== 1 || input.kind !== 'line-camera') throw Error('不是线控运镜路线');
  if (input.imageStroke?.space !== 'image-plane-2d' || !Array.isArray(input.imageStroke.points)) throw Error('缺少图像平面笔画');
  if (input.camera?.space !== 'white-box-3d' || input.camera.lift !== LIFT) throw Error('缺少白模三维机位换算');
  if (!['forward', 'reverse'].includes(input.direction)) throw Error('行进方向无效');
  if (!finite(Number(input.duration), LIMITS.minDuration, LIMITS.maxDuration)) throw Error('时长需为1–60秒');
  if (!finite(Number(input.camera.standoff), LIMITS.minStandoff, LIMITS.maxStandoff)) throw Error('机位距离需为1–12米');
  if (input.imageStroke.points.length > LIMITS.maxPoints) throw Error('路线最多48个点');
  const points = input.imageStroke.points.map(cleanPoint);
  assertGaps(points);
  return {
    version: 1,
    kind: 'line-camera',
    imageStroke: {space: 'image-plane-2d', points},
    camera: {space: 'white-box-3d', lift: LIFT, standoff: round(Number(input.camera.standoff)), focal: LIMITS.focal, roll: 0},
    direction: input.direction,
    duration: round2(Number(input.duration)),
    disclaimer: DISCLAIMER
  };
}

export function orderedPoints(route) {
  const current = normalizeRoute(route);
  return current.direction === 'reverse' ? [...current.imageStroke.points].reverse() : current.imageStroke.points.slice();
}

export function lookAt(u, v) {
  return {
    x: (u - 0.5) * BOARD.width,
    y: BOARD.baseY + (1 - v) * BOARD.height,
    z: BOARD.z
  };
}

export function cameraFromStroke(u, v, standoff) {
  const target = lookAt(u, v);
  return {x: target.x, y: target.y, z: target.z + standoff, tx: target.x, ty: target.y, tz: target.z, focal: LIMITS.focal, roll: 0};
}

export function pathLength(route) {
  const current = normalizeRoute(route);
  const points = orderedPoints(current);
  if (points.length < 2) return 0;
  let length = 0;
  let previous = cameraFromStroke(points[0].u, points[0].v, current.camera.standoff);
  for (let i = 1; i < points.length; i++) {
    const next = cameraFromStroke(points[i].u, points[i].v, current.camera.standoff);
    length += Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z);
    previous = next;
  }
  return length;
}

export function travelSpeed(route) {
  const current = normalizeRoute(route);
  const length = pathLength(current);
  return length > 0 ? length / current.duration : 0;
}

export function readiness(route) {
  const count = normalizeRoute(route).imageStroke.points.length;
  if (count === 0) return {ok: false, code: 'empty', message: '路线为空：先在图像上画出起点和终点'};
  if (count === 1) return {ok: false, code: 'single', message: '只有一个点：补上终点后才能预演和导出'};
  return {ok: true, code: 'ready', message: '可以预演'};
}

export function idlePose(route) {
  const current = normalizeRoute(route);
  return {...cameraFromStroke(0.5, 0.5, current.camera.standoff), time: 0, held: true};
}

export function samplePose(route, time) {
  const current = normalizeRoute(route);
  const points = orderedPoints(current);
  const t = Math.max(0, Math.min(current.duration, Number(time) || 0));
  if (!points.length) return null;
  const at = point => ({...cameraFromStroke(point.u, point.v, current.camera.standoff), time: t, held: points.length < 2});
  if (points.length < 2) return at(points[0]);
  if (t <= 0) return {...cameraFromStroke(points[0].u, points[0].v, current.camera.standoff), time: 0, held: false};
  if (t >= current.duration) return {...cameraFromStroke(points.at(-1).u, points.at(-1).v, current.camera.standoff), time: current.duration, held: false};
  const length = pathLength(current);
  if (!(length > 0)) return at(points[0]);
  let target = length * (t / current.duration);
  let walked = 0;
  let previous = cameraFromStroke(points[0].u, points[0].v, current.camera.standoff);
  for (let i = 1; i < points.length; i++) {
    const next = cameraFromStroke(points[i].u, points[i].v, current.camera.standoff);
    const segment = Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z);
    if (walked + segment >= target - 1e-9 || i === points.length - 1) {
      const mix = segment ? Math.max(0, Math.min(1, (target - walked) / segment)) : 1;
      const lerp = (a, b) => a + (b - a) * mix;
      return {
        x: lerp(previous.x, next.x), y: lerp(previous.y, next.y), z: lerp(previous.z, next.z),
        tx: lerp(previous.tx, next.tx), ty: lerp(previous.ty, next.ty), tz: lerp(previous.tz, next.tz),
        focal: LIMITS.focal, roll: 0, time: t, held: false
      };
    }
    walked += segment;
    previous = next;
  }
  return {...cameraFromStroke(points.at(-1).u, points.at(-1).v, current.camera.standoff), time: t, held: false};
}

export function stillPoses(route) {
  const ready = readiness(route);
  if (!ready.ok) throw Error(ready.message);
  const current = normalizeRoute(route);
  return [0, current.duration / 2, current.duration].map(time => ({time, pose: samplePose(current, time)}));
}

function edited(route, mutate) {
  const next = normalizeRoute(route);
  mutate(next);
  return normalizeRoute(next);
}

export function appendPoint(route, point) {
  return edited(route, next => {
    if (next.imageStroke.points.length >= LIMITS.maxPoints) throw Error('路线最多48个点');
    const clean = cleanPoint(point);
    const last = next.imageStroke.points.at(-1);
    if (last && Math.hypot(clean.u - last.u, clean.v - last.v) < LIMITS.minGap) throw Error('与上一点太近');
    next.imageStroke.points.push(clean);
  });
}

export function movePoint(route, id, point) {
  return edited(route, next => {
    const index = next.imageStroke.points.findIndex(item => item.id === id);
    if (index < 0) throw Error('找不到路线点');
    const clean = cleanPoint({...point, id});
    const previous = next.imageStroke.points[index - 1];
    const following = next.imageStroke.points[index + 1];
    if (previous && Math.hypot(clean.u - previous.u, clean.v - previous.v) < LIMITS.minGap) throw Error('与相邻点太近');
    if (following && Math.hypot(clean.u - following.u, clean.v - following.v) < LIMITS.minGap) throw Error('与相邻点太近');
    next.imageStroke.points[index] = clean;
  });
}

export function removePoint(route, id) {
  return edited(route, next => {
    const index = next.imageStroke.points.findIndex(item => item.id === id);
    if (index < 0) throw Error('找不到路线点');
    next.imageStroke.points.splice(index, 1);
  });
}

export function clearPoints(route) {
  return edited(route, next => { next.imageStroke.points = []; });
}

export function setDuration(route, seconds) {
  return edited(route, next => {
    const value = Number(seconds);
    if (!finite(value, LIMITS.minDuration, LIMITS.maxDuration)) throw Error('时长需为1–60秒');
    next.duration = value;
  });
}

export function setStandoff(route, meters) {
  return edited(route, next => {
    const value = Number(meters);
    if (!finite(value, LIMITS.minStandoff, LIMITS.maxStandoff)) throw Error('机位距离需为1–12米');
    next.camera.standoff = value;
  });
}

export function setSpeed(route, metersPerSecond) {
  const next = normalizeRoute(route);
  const length = pathLength(next);
  if (!(length > 0)) throw Error('路线太短，不能按速度换算时长');
  const speed = Number(metersPerSecond);
  if (!finite(speed, LIMITS.minSpeed, LIMITS.maxSpeed)) throw Error('速度需为0.05–20米/秒');
  const duration = length / speed;
  if (!finite(duration, LIMITS.minDuration, LIMITS.maxDuration)) throw Error('按该速度换算的时长超出1–60秒');
  next.duration = duration;
  return normalizeRoute(next);
}

export function reverseDirection(route) {
  return edited(route, next => { next.direction = next.direction === 'forward' ? 'reverse' : 'forward'; });
}

function simplify(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 4096) throw Error('手绘路线太短或采样点过多');
  const raw = input.map(point => ({u: Number(point.u), v: Number(point.v)}));
  if (raw.some(point => !finite(point.u, 0, 1) || !finite(point.v, 0, 1))) throw Error('手绘路线超出画面');
  const points = [];
  for (const point of raw) {
    if (!points.length || Math.hypot(point.u - points.at(-1).u, point.v - points.at(-1).v) >= LIMITS.minGap) points.push(point);
  }
  const end = raw.at(-1);
  if (points.length > 1 && Math.hypot(end.u - points.at(-1).u, end.v - points.at(-1).v) < LIMITS.minGap) points[points.length - 1] = end;
  if (points.length < 2 || points.every(point => Math.hypot(point.u - points[0].u, point.v - points[0].v) < LIMITS.minGap)) {
    throw Error('手绘路线太短，请按住鼠标画长一些');
  }
  const distance = (point, a, b) => {
    const du = b.u - a.u, dv = b.v - a.v, length = du * du + dv * dv;
    const t = length ? Math.max(0, Math.min(1, ((point.u - a.u) * du + (point.v - a.v) * dv) / length)) : 0;
    return Math.hypot(point.u - a.u - t * du, point.v - a.v - t * dv);
  };
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let error = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const deviation = distance(points[i], points[a], points[b]);
      if (deviation > error) { error = deviation; index = i; }
    }
    if (error > 0.012 && index > 0) { keep.add(index); stack.push([a, index], [index, b]); }
  }
  let out = [...keep].sort((a, b) => a - b).map(index => points[index]);
  if (out.length > LIMITS.maxPoints) {
    const reduced = [out[0]];
    const step = (out.length - 1) / (LIMITS.maxPoints - 1);
    for (let i = 1; i < LIMITS.maxPoints - 1; i++) reduced.push(out[Math.round(i * step)]);
    reduced.push(out.at(-1));
    out = reduced;
  }
  const filtered = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    if (Math.hypot(out[i].u - filtered.at(-1).u, out[i].v - filtered.at(-1).v) >= LIMITS.minGap) filtered.push(out[i]);
  }
  const last = out.at(-1);
  if (Math.hypot(last.u - filtered.at(-1).u, last.v - filtered.at(-1).v) < LIMITS.minGap) filtered[filtered.length - 1] = last;
  else filtered.push(last);
  if (filtered.length < 2) throw Error('手绘路线太短，请按住鼠标画长一些');
  return filtered.map(point => cleanPoint(point));
}

export function commitStroke(route, samples) {
  const points = simplify(samples);
  return edited(route, next => { next.imageStroke.points = points; });
}

export function nearestPoint(route, point, maxDistance = 0.06) {
  const current = normalizeRoute(route);
  let best = null;
  current.imageStroke.points.forEach((item, index) => {
    const distance = Math.hypot(item.u - Number(point.u), item.v - Number(point.v));
    if (distance <= maxDistance && (!best || distance < best.distance)) best = {id: item.id, index, distance};
  });
  return best;
}

export function serializeRoute(route) {
  return JSON.stringify(normalizeRoute(route));
}

export function parseRoute(text) {
  if (typeof text !== 'string' || text.length > LIMITS.maxJson) throw Error('路线文件需小于200KB');
  let data;
  try { data = JSON.parse(text); } catch { throw Error('路线 JSON 格式不正确'); }
  return normalizeRoute(data);
}

export function extractRoute(metadata) {
  if (!metadata || typeof metadata !== 'object' || metadata.lineCamera == null) return null;
  return normalizeRoute(metadata.lineCamera);
}

export function embedRoute(metadata, route) {
  const saved = normalizeRoute(route);
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? {...metadata} : {};
  base.lineCamera = saved;
  return base;
}

export function createPlayback(route) {
  let current = normalizeRoute(route);
  let time = 0;
  let playing = false;
  return {
    get route() { return current; },
    get time() { return time; },
    get playing() { return playing; },
    setRoute(next) {
      current = normalizeRoute(next);
      if (time > current.duration) time = current.duration;
      if (!readiness(current).ok) playing = false;
    },
    play() {
      const ready = readiness(current);
      if (!ready.ok) { playing = false; throw Error(ready.message); }
      if (time >= current.duration - 1e-6) time = 0;
      playing = true;
      return time;
    },
    pause() { playing = false; return time; },
    seek(value) {
      if (!Number.isFinite(value)) throw Error('时间无效');
      time = Math.max(0, Math.min(current.duration, value));
      return time;
    },
    tick(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw Error('时间步长无效');
      if (playing) {
        time = Math.min(current.duration, time + dt);
        if (time >= current.duration - 1e-9) { time = current.duration; playing = false; }
      }
      return {time, playing, pose: samplePose(current, time)};
    }
  };
}

export function seedLineCameraPlugin(storage, id = PLUGIN_ID) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return {changed: false, reason: 'unavailable'};
  }
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return {changed: false, reason: 'unavailable'}; }
  if (raw == null || raw === '') {
    const store = {[id]: {enabled: true, local: true}};
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return {changed: true, store};
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {changed: false, reason: 'invalid-json'}; }
  if (Array.isArray(parsed)) {
    if (parsed.some(item => item && item.id === id)) return {changed: false, reason: 'present', store: parsed};
    const store = [...parsed, {id, enabled: true, local: true}];
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return {changed: true, store};
  }
  if (!parsed || typeof parsed !== 'object') return {changed: false, reason: 'unknown-shape'};
  if (Object.prototype.hasOwnProperty.call(parsed, id)) return {changed: false, reason: 'present', store: parsed};
  const store = {...parsed, [id]: {enabled: true, local: true}};
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  return {changed: true, store};
}
