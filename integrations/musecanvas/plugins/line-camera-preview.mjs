// Local white-box preview. The picture plane and the camera view are drawn
// from the same route sample; neither one calls a generative model.
import {BOARD, cameraFromStroke, idlePose, normalizeRoute, orderedPoints, readiness, samplePose, stillPoses} from './line-camera-core.mjs';

const sub = (a, b) => a.map((value, index) => value - b[index]);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => { const n = Math.hypot(...vector) || 1; return vector.map(value => value / n); };

function basis(pose) {
  const eye = [pose.x, pose.y, pose.z];
  const f = unit(sub([pose.tx, pose.ty, pose.tz], eye));
  const r = unit(cross(f, Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]));
  const u = cross(r, f);
  return {eye, f, r, u};
}

function textureMatrix(src, dst) {
  const [[u0, v0], [u1, v1], [u2, v2]] = src;
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(det) < 1e-9) return null;
  const coefficients = index => {
    const d1 = dst[1][index] - dst[0][index], d2 = dst[2][index] - dst[0][index];
    const a = (d1 * (v2 - v0) - d2 * (v1 - v0)) / det;
    const b = ((u1 - u0) * d2 - (u2 - u0) * d1) / det;
    return [a, b, dst[0][index] - a * u0 - b * v0];
  };
  const x = coefficients(0), y = coefficients(1);
  return [x[0], y[0], x[1], y[1], x[2], y[2]];
}

export function drawStroke(canvas, route, image, draft = null) {
  const current = normalizeRoute(route);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (image?.width) ctx.drawImage(image, 0, 0, w, h);
  else {
    ctx.fillStyle = '#efe8dc';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c3b8a6';
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#5e564c';
    ctx.font = '16px sans-serif';
    ctx.fillText('图像平面（未绑定参考图）', 22, 36);
  }
  const xy = point => [point.u * w, point.v * h];
  const stroke = (points, color, width) => {
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((point, index) => { const [x, y] = xy(point); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  stroke(current.imageStroke.points, '#1f7a4d', 4);
  if (draft?.length) stroke(draft, '#e07a1f', 3);
  const markerSource = current.direction === 'reverse' ? [...current.imageStroke.points].reverse() : current.imageStroke.points;
  if (markerSource.length) {
    const start = markerSource[0], end = markerSource.at(-1);
    const drawMark = (point, color, label) => {
      const [x, y] = xy(point);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#17202a';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(label, x + 10, y - 8);
    };
    drawMark(start, '#1f9d55', '起');
    if (markerSource.length > 1) {
      drawMark(end, '#d64545', '终');
      const prev = markerSource.at(-2);
      const [x1, y1] = xy(prev), [x2, y2] = xy(end);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.translate(x2, y2);
      ctx.rotate(angle);
      ctx.fillStyle = '#d64545';
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(2, 6); ctx.lineTo(2, -6); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.fillRect(8, h - 28, 250, 20);
  ctx.fillStyle = '#243140';
  ctx.font = '12px sans-serif';
  ctx.fillText('2D 图像笔画 · 不是摄影机坐标', 14, h - 14);
}

function drawTexturedBoard(ctx, toCam, screen, image) {
  const n = image ? 4 : 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const corner = (u, v) => {
      const world = cameraFromStroke(u, v, 0);
      return {cam: toCam([world.tx, world.ty, world.tz]), u, v};
    };
    const cell = [corner(x / n, y / n), corner((x + 1) / n, y / n), corner((x + 1) / n, (y + 1) / n), corner(x / n, (y + 1) / n)];
    if (cell.some(item => item.cam[2] < 0.08)) continue;
    const paint = (indexes) => {
      const tri = indexes.map(index => cell[index]);
      const dst = tri.map(item => screen(item.cam));
      ctx.beginPath();
      dst.forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point));
      ctx.closePath();
      if (!image) { ctx.fillStyle = '#f4f1ea'; ctx.fill(); return; }
      const src = tri.map(item => [item.u * image.width, item.v * image.height]);
      const matrix = textureMatrix(src, dst);
      if (!matrix) return;
      ctx.save();
      ctx.clip();
      ctx.transform(...matrix);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    };
    paint([0, 1, 2]);
    paint([0, 2, 3]);
  }
}

function drawInset(ctx, route, pose, width, height) {
  const x = width - 176, y = 12, w = 164, h = 112;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#91a0b0';
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.fillStyle = '#243140';
  ctx.font = '11px sans-serif';
  ctx.fillText('俯视：笔画换算的机位', x + 8, y + 16);
  const map = (wx, wz) => [x + w / 2 + wx * 7, y + h / 2 + 8 + wz * 5];
  const roomA = map(-5, -6), roomB = map(5, 6);
  ctx.strokeStyle = '#b7c3cf';
  ctx.strokeRect(roomA[0], roomA[1], roomB[0] - roomA[0], roomB[1] - roomA[1]);
  const points = orderedPoints(route);
  ctx.beginPath();
  points.forEach((point, index) => {
    const camera = cameraFromStroke(point.u, point.v, route.camera.standoff);
    const mapped = map(camera.x, camera.z);
    index ? ctx.lineTo(...mapped) : ctx.moveTo(...mapped);
  });
  ctx.strokeStyle = '#1f7a4d';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (points.length) {
    const start = cameraFromStroke(points[0].u, points[0].v, route.camera.standoff);
    const end = cameraFromStroke(points.at(-1).u, points.at(-1).v, route.camera.standoff);
    for (const [camera, color] of [[start, '#1f9d55'], [end, '#d64545']]) {
      const mapped = map(camera.x, camera.z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(...mapped, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const here = map(pose.x, pose.z);
  ctx.fillStyle = '#e2a33a';
  ctx.fillRect(here[0] - 4, here[1] - 3, 8, 6);
  ctx.restore();
}

export function drawPreview(canvas, route, time, image) {
  const current = normalizeRoute(route);
  const pose = samplePose(current, time) || idlePose(current);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const frame = basis(pose);
  const focal = w * pose.focal / 36;
  const toCam = point => { const q = sub(point, frame.eye); return [dot(q, frame.r), dot(q, frame.u), dot(q, frame.f)]; };
  const screen = point => [w / 2 + point[0] / point[2] * focal, h / 2 - point[1] / point[2] * focal];
  ctx.fillStyle = '#d5dde6';
  ctx.fillRect(0, 0, w, h);
  const faces = [];
  const add = (corners, color) => {
    const projected = corners.map(toCam);
    if (projected.some(point => point[2] < 0.08)) return;
    faces.push({projected, color, depth: projected.reduce((sum, point) => sum + point[2], 0) / projected.length});
  };
  add([[-5, 0, -6], [5, 0, -6], [5, 0, 6], [-5, 0, 6]], '#f7f8f8');
  add([[-5, 0, -6], [5, 0, -6], [5, 4, -6], [-5, 4, -6]], '#e7edf2');
  add([[-5, 0, -6], [-5, 0, 6], [-5, 4, 6], [-5, 4, -6]], '#d7e0e8');
  add([[5, 0, 6], [5, 0, -6], [5, 4, -6], [5, 4, 6]], '#c9d4df');
  add([[-0.45, 0, -0.45], [0.45, 0, -0.45], [0.45, 0, 0.45], [-0.45, 0, 0.45]], '#fbfbfa');
  add([[-0.45, 1.15, -0.45], [0.45, 1.15, -0.45], [0.45, 1.15, 0.45], [-0.45, 1.15, 0.45]], '#ffffff');
  add([[-0.45, 0, 0.45], [0.45, 0, 0.45], [0.45, 1.15, 0.45], [-0.45, 1.15, 0.45]], '#f0f2f4');
  add([[0.45, 0, -0.45], [-0.45, 0, -0.45], [-0.45, 1.15, -0.45], [0.45, 1.15, -0.45]], '#e3e8ee');
  add([[-0.45, 0, -0.45], [-0.45, 0, 0.45], [-0.45, 1.15, 0.45], [-0.45, 1.15, -0.45]], '#e8eef3');
  add([[0.45, 0, 0.45], [0.45, 0, -0.45], [0.45, 1.15, -0.45], [0.45, 1.15, 0.45]], '#f7f7f6');
  faces.sort((a, b) => b.depth - a.depth);
  for (const face of faces) {
    ctx.beginPath();
    face.projected.forEach((point, index) => { const xy = screen(point); index ? ctx.lineTo(...xy) : ctx.moveTo(...xy); });
    ctx.closePath();
    ctx.fillStyle = face.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,54,68,.18)';
    ctx.stroke();
  }
  drawTexturedBoard(ctx, toCam, screen, image?.width ? image : null);
  drawInset(ctx, current, pose, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillRect(8, h - 28, 280, 20);
  ctx.fillStyle = '#243140';
  ctx.font = '12px sans-serif';
  ctx.fillText(`白模机位 · 本地几何 · 非生成成片  ${pose.time.toFixed(2)}s`, 14, h - 14);
  return pose;
}

export function canvasToBlob(canvas) {
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('静帧导出失败')), 'image/png'));
  }
  if (typeof canvas.toDataURL !== 'function') return Promise.reject(Error('当前环境不能导出 PNG'));
  const url = canvas.toDataURL('image/png');
  const body = atob(url.split(',')[1] || '');
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);
  return Promise.resolve(new Blob([bytes], {type: 'image/png'}));
}

export async function exportStills(canvas, route, image) {
  const shots = stillPoses(route);
  const names = ['线控运镜-首帧.png', '线控运镜-中帧.png', '线控运镜-尾帧.png'];
  const frames = [];
  for (let i = 0; i < shots.length; i++) {
    drawPreview(canvas, route, shots[i].time, image);
    frames.push({name: names[i], time: shots[i].time, blob: await canvasToBlob(canvas)});
  }
  return frames;
}

export async function exportVideo(canvas, route, image, {cancelled = () => false, onProgress = () => {}} = {}) {
  const ready = readiness(route);
  if (!ready.ok) throw Error(ready.message);
  const current = normalizeRoute(route);
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw Error('当前环境不能录制 WebM。可以导出静帧 PNG 和路线 JSON。');
  }
  const fps = 12;
  const mime = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  const stream = canvas.captureStream(0);
  const recorder = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined);
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => reject(Error('白模预演录制失败'));
    recorder.onstop = () => resolve(new Blob(chunks, {type: recorder.mimeType || 'video/webm'}));
  });
  recorder.start();
  const total = Math.max(2, Math.round(current.duration * fps));
  try {
    for (let i = 0; i < total; i++) {
      if (cancelled()) throw Error('导出已停止');
      drawPreview(canvas, current, i === total - 1 ? current.duration : current.duration * i / (total - 1), image);
      stream.getVideoTracks()[0]?.requestFrame?.();
      await new Promise(resolve => setTimeout(resolve, Math.round(1000 / fps)));
      onProgress((i + 1) / total);
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
  }
  const blob = await done;
  if (cancelled()) throw Error('导出已停止');
  if (!blob.size) throw Error('没有录到白模预演');
  return blob;
}

export const boardSize = BOARD;
