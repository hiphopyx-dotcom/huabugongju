// Plans which still references will actually be sent.
// Wire shapes follow this repo's image adapter and the observed canvas call.
// Roles stay in the prompt text and the preview. They are not request fields.
// This module never calls fetch. readStillRefSource uses the caller's fetchImpl.

import {presentSeq, seqText, sourceImage} from './seq-stamp.mjs';

/** Verified in deploy/lib/images.mjs. Not taken from a third-party model card. */
export const STILL_REF_CONTRACT = Object.freeze({
  referenceLimit: 3,
  referenceBytes: 768 * 1024,
  mimes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  imageReferenceKeys: Object.freeze(['id', 'dataUrl']),
  stillBodyKeys: Object.freeze(['prompt', 'aspect', 'resolution', 'refs', 'projectId', 'projectName', 'name', 'entityKind', 'shotNo']),
});

/**
 * deploy/lib/images.mjs keeps RESOLUTIONS as ['1k','2k'] and rejects anything else.
 * This repo has no /api/pianchang-still handler, so the canvas sends only those two.
 */
export const STILL_WIRE_RESOLUTIONS = Object.freeze(['1k', '2k']);

const DATA_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_TYPE = new Set(['人物', '角色', '场景', '道具', '分镜']);
const FRAME_NOTES = Object.freeze({
  '9:16': 'Vertical 9:16 smartphone / short-drama frame, full-height composition, no letterboxing.',
  '3:4': 'Portrait 3:4 frame, catalog still.',
  '1:1': 'Square 1:1 frame.',
  '16:9': 'Widescreen 16:9 cinematic frame.',
});
const PHOTO_LINE = 'Photoreal live-action cinematography. Real human skin and cloth. NEVER a 3D render, CGI mannequin, clay dummy, game-engine screenshot, untextured figure, or gray/beige capsule body.';

export class StillRefError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StillRefError';
    this.details = details;
  }
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function inspectDataUrl(value, maxBytes = STILL_REF_CONTRACT.referenceBytes) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return {ok: false, reason: 'not-data-url'};
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 64) return {ok: false, reason: 'too-large'};
  const match = DATA_RE.exec(value);
  if (!match || match[2].length % 4 !== 0) return {ok: false, reason: 'unsupported-image'};
  const pad = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  const bytes = (match[2].length / 4) * 3 - pad;
  if (!bytes || bytes > maxBytes) return {ok: false, reason: 'too-large'};
  return {ok: true, dataUrl: value, mime: match[1], bytes};
}

function asRecord(ref) {
  if (typeof ref === 'string') return {src: ref};
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  return ref;
}

function labelOf(ref, index) {
  const row = asRecord(ref);
  if (!row) return `参考${index + 1}`;
  return clean(row.name, 120) || clean(row.id, 80) || `参考${index + 1}`;
}

function roleOf(ref) {
  const row = asRecord(ref);
  if (!row) return '';
  const role = clean(row.role, 40);
  if (role) return role;
  const type = clean(row.type, 40);
  return KNOWN_TYPE.has(type) ? type : '';
}

function libraryIdOf(ref) {
  const row = asRecord(ref);
  if (!row) return '';
  const candidates = [row.imageLibraryId, row.id];
  for (const value of candidates) {
    if (typeof value === 'string' && UUID.test(value)) return value.toLowerCase();
  }
  return '';
}

function sourceOf(ref) {
  const row = asRecord(ref);
  if (!row) return '';
  if (typeof row.src === 'string' && row.src) return row.src;
  if (typeof row.dataUrl === 'string' && row.dataUrl) return row.dataUrl;
  return '';
}

function readableKind(src, origin) {
  if (typeof src !== 'string' || !src || src.startsWith('data:')) return '';
  if (src.startsWith('blob:')) return 'blob';
  if (src.startsWith('/') && !src.startsWith('//') && !src.startsWith('/\\')) return 'path';
  let url;
  try { url = new URL(src); } catch { return ''; }
  if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) return '';
  if (typeof origin !== 'string' || !origin) return '';
  let allowed;
  try { allowed = new URL(origin); } catch { return ''; }
  if ((allowed.protocol !== 'https:' && allowed.protocol !== 'http:') || allowed.origin !== url.origin) return '';
  return 'same-origin';
}

function reasonText(reason, name) {
  if (reason === 'too-large') return `参考图「${name}」超过 768KB，没有发送`;
  if (reason === 'unsupported-image') return `参考图「${name}」不是 PNG、JPEG 或 WebP，没有发送`;
  if (reason === 'remote') return `参考图「${name}」是外部地址。规划器不会去拉取，当前出图请求也只接受图片数据，没有发送`;
  if (reason === 'unread') return `参考图「${name}」还不是图片数据。需要调用方读出后再发送；这次没有发送`;
  if (reason === 'library-only') return `参考图「${name}」只有图库编号。当前这条出图请求只接受图片数据，没有发送`;
  if (reason === 'empty') return `参考图「${name}」没有可读的图片，没有发送`;
  if (reason === 'bad-read') return `参考图「${name}」读出来仍不是可用图片，没有发送`;
  return `参考图「${name}」无法发送`;
}

function resolveLimit(options, wire) {
  const verified = STILL_REF_CONTRACT.referenceLimit;
  if (options.limit == null) return {limit: verified, note: ''};
  const requested = options.limit;
  if (!Number.isInteger(requested) || requested < 1) throw new StillRefError('参考张数上限无法识别，没有发送', {code: 'bad-limit'});
  if (wire === 'images' && requested !== verified) {
    throw new StillRefError('图片接口最多 3 张参考图。多出来的不会悄悄丢掉，请先减少后再试。', {code: 'images-limit'});
  }
  const note = requested > verified
    ? `调用方上限是 ${requested} 张。本仓库 /api/images 最多 ${verified} 张。/api/pianchang-still 不在本仓库，超过 ${verified} 张没有被这个仓库验证。`
    : '';
  return {limit: requested, note};
}

function overLimitError(list, limit) {
  const dropped = list.slice(limit).map((ref, offset) => labelOf(ref, limit + offset));
  const kept = list.slice(0, limit).map(labelOf);
  return new StillRefError(
    `参考图有 ${list.length} 张，当前上限是 ${limit} 张。不会只发送前 ${limit} 张。请先拿掉：${dropped.join('、')}。按原顺序仍想保留的是：${kept.join('、') || '无'}。`,
    {code: 'over-limit', dropped, kept},
  );
}

function promptLine(item, ref) {
  const lines = [`<IMAGE_${item.index}> ${item.name}${item.role ? `（${item.role}）` : ''}`];
  const row = asRecord(ref) || {};
  if (item.role === 'stage_frame') {
    lines.push(`IMAGE_${item.index} is this shot's white-stage camera frame: keep its camera position, framing and blocking; paint it as photoreal live action.`);
    lines.push(`Fuse uploaded reference <IMAGE_${item.index}> into this still for identity and style.`);
    return lines;
  }
  if (item.role === '人物' || item.role === '角色' || item.role === 'character') {
    const look = clean(row.appearance || row.description, 500);
    const costume = clean(row.costume, 500);
    lines.push([look && `外貌：${look}`, `wardrobe: ${costume}`].filter(Boolean).join(' '));
    lines.push(`Match the face, hair, glasses, and costume of <IMAGE_${item.index}> exactly. Change only camera angle or micro-expression. Still exactly one person. Same gray backdrop and lighting.`);
  } else if (item.role === '道具' || item.role === 'prop') {
    const material = clean(row.material, 300);
    const used = clean(row.used_by || row.usedBy, 120);
    lines.push(`Studio product still of a film prop: ${item.name}. ${clean(row.description, 500)}. Material and wear: ${material}. Used by ${used}.`);
  } else if (item.role === '场景' || item.role === 'location') {
    lines.push(`Location: ${item.name}.`);
  }
  return lines;
}

function buildNotes(items, refs, ratio) {
  const notes = [];
  items.forEach((item, index) => notes.push(...promptLine(item, refs[index])));
  if (items.length >= 2) notes.push(`Use reference images: <IMAGE_0> to <IMAGE_${items.length - 1}> for identity of people, place, and props.`);
  if (items.some(item => item.role === 'stage_frame')) notes.push(PHOTO_LINE);
  const frame = FRAME_NOTES[ratio] || '';
  if (frame) notes.push(frame);
  return notes;
}

function baseItem(ref, index, extra) {
  return {
    index,
    name: labelOf(ref, index),
    role: roleOf(ref),
    previewSrc: '',
    dataUrl: '',
    libraryId: '',
    ...extra,
  };
}

function classifyOne(ref, index, options, wire) {
  if (asRecord(ref) == null) {
    return {item: baseItem(ref, index, {state: 'blocked', reason: 'empty'}), blocked: reasonText('empty', labelOf(ref, index))};
  }
  const name = labelOf(ref, index);
  const src = sourceOf(ref);
  const libraryId = libraryIdOf(ref);
  if (src.startsWith('data:')) {
    const inspected = inspectDataUrl(src);
    if (!inspected.ok) return {item: baseItem(ref, index, {state: 'blocked', reason: inspected.reason}), blocked: reasonText(inspected.reason, name)};
    if (wire === 'images' && libraryId) {
      return {item: baseItem(ref, index, {state: 'blocked', reason: 'ambiguous'}), blocked: `参考图「${name}」同时有图库编号和图片数据，没有替你选择，请只保留一种`};
    }
    return {item: baseItem(ref, index, {state: 'ready', previewSrc: inspected.dataUrl, dataUrl: inspected.dataUrl})};
  }
  if (wire === 'images' && libraryId && !src) {
    return {item: baseItem(ref, index, {state: 'ready', libraryId})};
  }
  if (!src && libraryId && wire === 'still') {
    return {item: baseItem(ref, index, {state: 'blocked', reason: 'library-only'}), blocked: reasonText('library-only', name)};
  }
  if (!src) return {item: baseItem(ref, index, {state: 'blocked', reason: 'empty'}), blocked: reasonText('empty', name)};
  const kind = readableKind(src, options.origin);
  if (!kind) return {item: baseItem(ref, index, {state: 'blocked', reason: 'remote'}), blocked: reasonText('remote', name)};
  return {item: baseItem(ref, index, {state: 'unread', reason: 'unread', readKind: kind}), blocked: options.read ? '' : reasonText('unread', name)};
}

function imageWireItem(item) {
  if (item.libraryId) return {id: item.libraryId};
  return {dataUrl: item.dataUrl};
}

function finish(wire, limit, items, refs, options, diagnostics, error) {
  const exact = !error && items.length === refs.length && items.every(item => item.state === 'ready');
  for (const item of items) item.sentAs = wire === 'images' && item.libraryId ? 'id' : item.dataUrl ? 'dataUrl' : '';
  return {
    ok: exact,
    exact,
    wire,
    limit,
    items,
    promptNotes: exact ? buildNotes(items, refs, options.ratio || '') : [],
    diagnostics: diagnostics.filter(Boolean),
    error: error || '',
    ...(wire === 'still' ? {stillRefs: exact ? items.map(item => item.dataUrl) : []} : {}),
    ...(wire === 'images' ? {imageReferences: exact ? items.map(imageWireItem) : []} : {}),
  };
}

export function classifyStillReferences(refs, options = {}) {
  const wire = options.wire === 'images' ? 'images' : options.wire === 'still' ? 'still' : '';
  if (!wire) return finish('still', STILL_REF_CONTRACT.referenceLimit, [], [], options, [], '未指定出图请求种类，没有发送');
  let limitNote = '';
  try {
    const resolved = resolveLimit(options, wire);
    limitNote = resolved.note;
    const list = Array.isArray(refs) ? refs : null;
    if (!list) return finish(wire, resolved.limit, [], [], options, [limitNote], '参考图列表无效，没有发送');
    if (list.length > resolved.limit) {
      const items = list.map((ref, index) => baseItem(ref, index, {state: index < resolved.limit ? 'not-sent' : 'over-cap'}));
      return finish(wire, resolved.limit, items, list, options, [limitNote], overLimitError(list, resolved.limit).message);
    }
    const items = [];
    const problems = [];
    for (let index = 0; index < list.length; index++) {
      const one = classifyOne(list[index], index, options, wire);
      items.push(one.item);
      if (one.blocked) problems.push(one.blocked);
    }
    const pending = items.some(item => item.state === 'unread');
    const error = problems[0] || (pending ? '还有参考图没读成图片数据，不能把它算作即将发送' : '');
    return finish(wire, resolved.limit, items, list, options, [limitNote], error);
  } catch (error) {
    return finish(wire, STILL_REF_CONTRACT.referenceLimit, [], [], options, [limitNote], error.message || '参考图没有发出去');
  }
}

async function resolveRead(ref, index, options, wire) {
  const first = classifyOne(ref, index, {...options, read: true}, wire);
  if (first.item.state !== 'unread') {
    if (first.blocked) throw new StillRefError(first.blocked, {code: first.item.reason || 'blocked', index, name: first.item.name});
    return first.item;
  }
  if (typeof options.read !== 'function') throw new StillRefError(reasonText('unread', first.item.name), {code: 'unread', index, name: first.item.name});
  let value = '';
  try { value = await options.read(ref, index); }
  catch (error) {
    if (error instanceof StillRefError) throw error;
    throw new StillRefError(`参考图「${first.item.name}」读取失败：${error?.message || '读不出来'}。没有发送`, {code: 'read-failed', index, name: first.item.name});
  }
  const inspected = inspectDataUrl(typeof value === 'string' ? value : '');
  if (!inspected.ok) throw new StillRefError(reasonText('bad-read', first.item.name), {code: 'bad-read', index, name: first.item.name});
  if (wire === 'images' && libraryIdOf(ref)) {
    throw new StillRefError(`参考图「${first.item.name}」读出了图片数据，本身又有图库编号，没有替你选择，请只保留一种`, {code: 'ambiguous', index, name: first.item.name});
  }
  return baseItem(ref, index, {state: 'ready', previewSrc: inspected.dataUrl, dataUrl: inspected.dataUrl});
}

export async function planStillReferences(refs, options = {}) {
  const wire = options.wire === 'images' ? 'images' : options.wire === 'still' ? 'still' : '';
  if (!wire) throw new StillRefError('未指定出图请求种类，没有发送', {code: 'wire'});
  const {limit, note} = resolveLimit(options, wire);
  if (!Array.isArray(refs)) throw new StillRefError('参考图列表无效，没有发送', {code: 'refs'});
  if (refs.length > limit) throw overLimitError(refs, limit);
  const items = [];
  for (let index = 0; index < refs.length; index++) items.push(await resolveRead(refs[index], index, options, wire));
  const plan = finish(wire, limit, items, refs, options, [note], '');
  if (!plan.ok) throw new StillRefError(plan.error || '参考图没有发出去', {code: 'plan'});
  return plan;
}

export function appendRefPrompt(prompt, plan) {
  const notes = Array.isArray(plan) ? plan : plan?.promptNotes || [];
  return [String(prompt ?? '').trim(), ...notes].filter(Boolean).join('\n');
}

/** Node menu values. 4K stays visible and disabled: the image API has no 4k tier. */
export function mapStillResolution(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === '1k') return {wire: '1k', requested: '1K', given: '1K', enabled: true, label: '1K'};
  if (key === '2k') return {wire: '2k', requested: '2K', given: '2K', enabled: true, label: '2K'};
  if (key === '4k') return {wire: '2k', requested: '4K', given: '2K', enabled: false, label: '4K（实际按 2K 出图）'};
  return {wire: '1k', requested: String(value ?? '').trim(), given: '1K', enabled: !String(value ?? '').trim(), label: '1K'};
}

export function stillResolutionOptions() {
  return [
    {value: '1K', label: '1K', enabled: true},
    {value: '2K', label: '2K', enabled: true},
    {value: '4K', label: mapStillResolution('4K').label, enabled: false},
  ];
}

/** Body fields already sent by the live canvas. No role, seed, or extra key. */
export function stillRequestBody({prompt, ratio, plan, meta, resolution} = {}) {
  if (!plan?.ok || plan.wire !== 'still' || !Array.isArray(plan.stillRefs)) throw new StillRefError('参考图还不能发送', {code: 'body'});
  const extra = meta && typeof meta === 'object' ? meta : {};
  const requested = resolution !== undefined ? resolution : extra.resolution;
  const mapped = mapStillResolution(requested);
  if (!STILL_WIRE_RESOLUTIONS.includes(mapped.wire)) throw new StillRefError('清晰度无法发送', {code: 'resolution'});
  const body = {
    prompt: typeof prompt === 'string' ? prompt : '',
    aspect: ratio || '16:9',
    resolution: mapped.wire,
    refs: plan.stillRefs.slice(),
    projectId: extra.projectId || '',
    projectName: extra.projectName || '',
    name: extra.name || '',
    entityKind: extra.entityKind || '',
    shotNo: extra.shotNo || '',
  };
  for (const key of Object.keys(body)) {
    if (!STILL_REF_CONTRACT.stillBodyKeys.includes(key)) delete body[key];
  }
  return body;
}

function refId(ref) {
  const row = asRecord(ref);
  return row && typeof row.id === 'string' ? row.id : '';
}

/** Own images first, then each incoming edge's images, capped at the still limit. */
export function assembleStillRefs({own = [], edges = [], limit = STILL_REF_CONTRACT.referenceLimit} = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : STILL_REF_CONTRACT.referenceLimit;
  const refs = [];
  const omitted = [];
  const seen = new Set();
  const consider = (ref) => {
    if (asRecord(ref) == null) return;
    const id = refId(ref);
    if (id && seen.has(id)) return;
    if (refs.length >= cap) {
      omitted.push(labelOf(ref, refs.length + omitted.length));
      if (id) seen.add(id);
      return;
    }
    if (id) seen.add(id);
    refs.push(ref);
  };
  const groups = [
    Array.isArray(own) ? own : [],
    ...(Array.isArray(edges) ? edges : []).map(edge => Array.isArray(edge) ? edge : (Array.isArray(edge?.images) ? edge.images : [])),
  ];
  for (const group of groups) for (const ref of group) consider(ref);
  return {refs, omitted, limit: cap};
}

function imagesOnUpstream(node, lookup) {
  if (!node) return [];
  const out = [];
  const seen = new Set();
  const push = (id) => {
    if (!id || seen.has(id)) return;
    const asset = lookup(id);
    if (!asset || asset.kind !== 'image') return;
    seen.add(id);
    out.push(asset);
  };
  push(node.resultAssetId);
  for (const id of node.assetIds || []) push(id);
  return out;
}

/**
 * node.assetIds images first (not the node's own result).
 * Then each incoming edge, in edge-list order: upstream result, then that node's image assets.
 */
export function collectStillRefs({node, edges, lookup, limit = STILL_REF_CONTRACT.referenceLimit} = {}) {
  const find = typeof lookup === 'function' ? lookup : () => null;
  const own = [];
  const seen = new Set();
  for (const id of node?.assetIds || []) {
    if (!id || seen.has(id)) continue;
    const asset = find(id);
    if (!asset || asset.kind !== 'image') continue;
    seen.add(id);
    own.push(asset);
  }
  const groups = (Array.isArray(edges) ? edges : []).map(edge => imagesOnUpstream(edge?.from ?? edge, find));
  return assembleStillRefs({own, edges: groups, limit});
}

/** Which non-data sources may be read with the page's own fetch. Others are refused. */
export function stillRefFetchTarget(src, origin) {
  const value = typeof src === 'string' ? src : '';
  if (!value || value.startsWith('data:')) return {ok: false, reason: value.startsWith('data:') ? 'data' : 'empty'};
  if (value.startsWith('blob:')) return {ok: true, url: value, kind: 'blob'};
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    const path = value.split('?')[0];
    let params;
    try { params = new URLSearchParams(value.includes('?') ? value.slice(value.indexOf('?') + 1) : ''); }
    catch { params = new URLSearchParams(); }
    if (path === '/api/collaboration' && params.get('action') === 'media') return {ok: true, url: value, kind: 'collaboration'};
    if (path === '/api/images' || path.startsWith('/api/images/')) return {ok: true, url: value, kind: 'images'};
    return {ok: false, reason: 'remote'};
  }
  let url;
  try { url = new URL(value); } catch { return {ok: false, reason: 'remote'}; }
  if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) return {ok: false, reason: 'remote'};
  if (typeof origin !== 'string' || !origin) return {ok: false, reason: 'remote'};
  let allowed;
  try { allowed = new URL(origin); } catch { return {ok: false, reason: 'remote'}; }
  if ((allowed.protocol !== 'https:' && allowed.protocol !== 'http:') || allowed.origin !== url.origin) return {ok: false, reason: 'remote'};
  return {ok: true, url: url.href, kind: 'same-origin'};
}

async function dataUrlFromBlob(blob, name) {
  const mime = String(blob?.type || '').split(';')[0].trim().toLowerCase();
  if (mime && !/^image\/(png|jpeg|webp)$/.test(mime)) throw new StillRefError(reasonText('unsupported-image', name), {code: 'unsupported-image', name});
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (!buf.byteLength) throw new StillRefError(reasonText('bad-read', name), {code: 'bad-read', name});
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) binary += String.fromCharCode(...buf.subarray(i, i + step));
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`;
}

/** Turn a same-origin or blob ref into a data URL. Throws instead of returning an empty src. */
export async function readStillRefSource(src, {origin, fetchImpl, readLocal, name = '参考图'} = {}) {
  const value = typeof src === 'string' ? src : (typeof src?.src === 'string' ? src.src : '');
  const label = clean(name, 120) || '参考图';
  if (value.startsWith('data:')) return value;
  if (typeof readLocal === 'function') {
    try {
      const local = String(await readLocal() || '');
      if (local.startsWith('data:')) return local;
    } catch (error) {
      throw new StillRefError(`参考图「${label}」读取失败：${error?.message || '读不出来'}。没有发送`, {code: 'read-failed', name: label});
    }
  }
  const target = stillRefFetchTarget(value, origin);
  if (!target.ok) throw new StillRefError(reasonText(target.reason === 'empty' ? 'empty' : 'remote', label), {code: target.reason === 'empty' ? 'empty' : 'remote', name: label});
  if (typeof fetchImpl !== 'function') throw new StillRefError(reasonText('unread', label), {code: 'unread', name: label});
  let res;
  try { res = await fetchImpl(target.url, {credentials: 'same-origin'}); }
  catch (error) { throw new StillRefError(`参考图「${label}」读取失败：${error?.message || '读不出来'}。没有发送`, {code: 'read-failed', name: label}); }
  if (!res?.ok) throw new StillRefError(`参考图「${label}」读取失败（${res?.status || '失败'}）。没有发送`, {code: 'read-failed', name: label, status: res?.status || 0});
  if (typeof res.blob !== 'function') throw new StillRefError(reasonText('bad-read', label), {code: 'bad-read', name: label});
  return dataUrlFromBlob(await res.blob(), label);
}

export async function digestStillRef(dataUrl) {
  const raw = sourceImage(dataUrl);
  const inspected = inspectDataUrl(raw);
  if (!inspected.ok) throw new StillRefError(reasonText(inspected.reason === 'not-data-url' ? 'bad-read' : inspected.reason, '参考图'), {code: inspected.reason || 'bad-read'});
  const payload = raw.slice(raw.indexOf(',') + 1);
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new StillRefError('这个环境算不出参考图摘要，没有发送', {code: 'digest'});
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return {format: inspected.mime, bytes: inspected.bytes, sha256: hex.slice(0, 12)};
}

/** Assembles the still body and a text-only summary. Does not post it. */
export async function rehearseStillRequest({prompt, ratio, plan, meta, resolution, omitted = []} = {}) {
  const body = stillRequestBody({prompt, ratio, plan, meta, resolution});
  const order = [];
  for (let index = 0; index < body.refs.length; index++) {
    const row = await digestStillRef(body.refs[index]);
    order.push({i: index + 1, format: row.format, bytes: row.bytes, sha256: row.sha256});
  }
  const summary = {
    count: order.length,
    order,
    resolution: body.resolution,
    omitted: (Array.isArray(omitted) ? omitted : []).map(name => clean(name, 120)).filter(Boolean),
    sent: false,
  };
  if (JSON.stringify(summary).includes('data:')) throw new StillRefError('演练结果不能带图片数据', {code: 'rehearse'});
  return summary;
}

export function renderStillNodeError(message) {
  const text = clean(message, 400);
  if (!text) return '';
  return `<p class="still-error" role="alert" data-still-node-error>${esc(text)}</p>`;
}

export function renderStillRehearsal(summary) {
  if (!summary || typeof summary !== 'object' || summary.sent !== false) return '';
  const order = (Array.isArray(summary.order) ? summary.order : []).map(row => ({
    i: Number(row?.i) || 0,
    format: clean(row?.format, 40),
    bytes: Number(row?.bytes) || 0,
    sha256: clean(row?.sha256, 12),
  }));
  if (order.some(row => !/^[0-9a-f]{12}$/.test(row.sha256) || !/^image\/(?:png|jpeg|webp)$/.test(row.format))) return '';
  const omitted = (Array.isArray(summary.omitted) ? summary.omitted : []).map(name => clean(name, 120)).filter(name => name && !String(name).includes('data:'));
  const lines = [
    '演练（未发送）',
    `参考 ${Number(summary.count) || 0} 张`,
    `分辨率 ${clean(summary.resolution, 16)}`,
    ...order.map(row => `${row.i}. ${row.format} · ${row.bytes} 字节 · sha256 ${row.sha256}`),
  ];
  if (omitted.length) lines.push(`未纳入：${omitted.join('、')}`);
  const text = lines.join('\n');
  if (/data:/i.test(text)) return '';
  return `<pre class="still-rehearsal" data-still-rehearsal>${esc(text)}</pre>`;
}

export function createStillRun() {
  return {status: 'idle', output: '', held: '', error: '', seqLabel: '', attempt: 0};
}

export function beginAttempt(run, sent = []) {
  if (!run || run.status === 'running') throw new StillRefError('这一张还在生成，没有再次提交', {code: 'busy'});
  const kept = run.output || run.held || '';
  return {...run, status: 'running', error: '', attempt: (Number(run.attempt) || 0) + 1, held: kept, output: kept, seqLabel: run.seqLabel || '', sent};
}

export function failAttempt(run, error) {
  if (!run || run.status !== 'running') throw new StillRefError('没有进行中的生成，不能记成失败', {code: 'not-running'});
  const output = run.held || run.output || '';
  return {...run, status: 'failed', error: String(error?.message || error || '出图失败'), output, held: output, seqLabel: output ? (run.seqLabel || '') : ''};
}

export function finishAttempt(run, dataUrl, seqLabel) {
  if (!run || run.status !== 'running') throw new StillRefError('没有进行中的生成', {code: 'not-running'});
  const shown = presentSeq(dataUrl, seqLabel);
  if (!shown.dataUrl || shown.dataUrl !== dataUrl) throw new StillRefError('出图结果不能盖章或改写', {code: 'stamp'});
  return {...run, status: 'done', error: '', output: shown.dataUrl, held: shown.dataUrl, seqLabel: shown.seqLabel};
}

const STATUS_TEXT = {idle: '还没生成', running: '生成中', failed: '失败，可以重试', done: '已完成'};

function thumb(item, exact) {
  const badge = `<span class="still-index" aria-hidden="true">${item.index + 1}</span>`;
  const how = !exact ? '<small>这次不会发送</small>' : item.sentAs === 'id' ? `<small>请求只带图库编号 ${esc(item.libraryId)}</small>` : item.sentAs === 'dataUrl' ? '<small>请求带这张图片数据</small>' : '';
  const caption = `<figcaption><b>${esc(item.name)}</b>${item.role ? `<small>${esc(item.role)}</small>` : ''}${how}</figcaption>`;
  if (item.previewSrc) return `<figure class="still-ref${exact ? '' : ' is-held'}" data-still-ref="${item.index}" data-still-state="${esc(item.state)}">${badge}<img src="${esc(item.previewSrc)}" alt="${exact ? '将发送的参考' : '未发送的参考'} ${item.index + 1} ${esc(item.name)}">${caption}</figure>`;
  const pending = item.state === 'unread' ? '还没读成图片数据' : item.state === 'over-cap' ? '超出上限，不会发送' : !exact ? '这次不会发送' : item.libraryId ? '按图库编号发送' : '不会发送';
  return `<figure class="still-ref is-empty" data-still-ref="${item.index}" data-still-state="${esc(item.state || 'blocked')}">${badge}<span class="still-missing">${esc(pending)}</span>${caption}</figure>`;
}

export function renderStillCompare({plan, run, title = '将发送的参考图', retryAct = ''} = {}) {
  const view = run || createStillRun();
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const exact = !!plan?.exact;
  const banner = plan?.error
    ? plan.error
    : exact
      ? `将发送 ${items.length} 张，顺序如下`
      : '还不能确定将发送的图片';
  const status = STATUS_TEXT[view.status] || STATUS_TEXT.idle;
  const output = view.output || '';
  const seq = seqText(view.seqLabel);
  const outputFigure = output
    ? `<figure class="still-output" data-still-output><img src="${esc(output)}" alt="生成结果"><span class="still-seq">${seq ? esc(seq) : ''}</span><figcaption>${view.status === 'done' ? '这一张结果' : '上一张结果还在'}</figcaption></figure>`
    : `<figure class="still-output is-empty" data-still-output><span class="still-missing">还没有结果</span><figcaption>输出</figcaption></figure>`;
  const retry = view.status === 'failed' ? `<button type="button" data-still-act="retry"${retryAct ? ` data-act="${esc(retryAct)}"` : ''}>用同一批参考重试</button>` : '';
  const notes = (plan?.diagnostics || []).filter(Boolean).map(line => `<p class="still-note">${esc(line)}</p>`).join('');
  const error = view.error ? `<p class="still-error" role="alert">${esc(view.error)}</p>` : '';
  return `<section class="still-compare" data-still-status="${esc(view.status)}" data-still-exact="${exact ? 'yes' : 'no'}"><div class="still-head"><h3>${esc(title)}</h3><p data-still-banner>${esc(banner)}</p><p class="still-status">状态：${esc(status)}${view.attempt ? ` · 第 ${view.attempt} 次` : ''}</p></div><div class="still-cols"><div class="still-refs">${items.map(item => thumb(item, exact)).join('') || '<p class="still-missing">这次不带参考图</p>'}</div>${outputFigure}</div>${notes}${error}${retry}<p class="still-footnote">编号只显示在角标上，没有写进图片。</p></section>`;
}

export {seqText, presentSeq};
