import {wardrobeLockPrompt, isCharacterFollowKind} from './wardrobe-lock.mjs';
// Local-only adapter for sunny-terra's real /api/backup -> createUserBackup
// contract at d0daeebb40009982b84a043e8dc2f8811134d23e. Never upload/persist the
// original backup: jingben_members may include password hashes. A local file
// declares an owner; it does not remotely authenticate that legacy identity.
export const IMAGE_WORKSHOP_LIMITS = Object.freeze({
  bytes: 128 * 1024 * 1024, imageBytes: 25 * 1024 * 1024,
  images: 2000, rows: 10000, text: 65536, archiveEntries: 64,
});

export const IMAGE_WORKSHOP_CATEGORIES = Object.freeze([
  Object.freeze({id: 'characters', label: '角色'}),
  Object.freeze({id: 'locations', label: '场景'}),
  Object.freeze({id: 'props', label: '道具'}),
  Object.freeze({id: 'storyboard', label: '分镜'}),
]);

const records = new WeakMap();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const byteLength = s => new TextEncoder().encode(s).byteLength;
const labels = Object.fromEntries(IMAGE_WORKSHOP_CATEGORIES.map(c => [c.id, c.label]));
const entityTables = {characters: 'jingben_characters', locations: 'jingben_locations', props: 'jingben_props', storyboard: 'jingben_beats'};
const kindLabels = Object.freeze({
  front: '正面', side: '侧面', back: '背面', expr_neutral: '自然表情',
  expr_smile: '微笑', expr_anger: '愤怒', expr_stern: '严肃', expr_cry: '哭泣',
  expr_sad: '悲伤', expr_fear: '恐惧', expr_provoke: '挑衅', expr_stare: '凝视',
  expr_surprise: '惊讶', expr_disgust: '厌恶', expr_think: '思考',
  plan: '俯视白模', view_n: '北机位', view_w: '西机位', view_e: '东机位', view_s: '南机位',
  establishing: '环境全景', wide: '全景', interior: '室内', hero: '道具主图',
  frame: '分镜主机位', reverse: '反打', detail: '细节',
});

function text(v, label, max = IMAGE_WORKSHOP_LIMITS.text, fallback = '') {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw Error(`${label}必须是文字`);
  if (v.length > max) throw Error(`${label}过长，请分开导入；原文没有被截断`);
  return v;
}

function id(v, label) {
  const s = text(v, label, 256);
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) throw Error(`${label}无效`);
  return s;
}

function rows(data, table, required = false) {
  const list = data[table];
  if (list === undefined && !required) return [];
  if (!Array.isArray(list) || list.some(row => !object(row))) throw Error(`${table}不是有效的记录列表`);
  const max = table === 'jingben_images' ? IMAGE_WORKSHOP_LIMITS.images : IMAGE_WORKSHOP_LIMITS.rows;
  if (list.length > max) throw Error(`${table}超过${max}项，请分开导入；记录没有被截断`);
  return list;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function parse(raw) {
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const b = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (b.byteLength > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('备份超过128 MB，请分开导入');
    try { raw = new TextDecoder('utf-8', {fatal: true}).decode(b); } catch { throw Error('备份不是有效的 UTF-8 JSON'); }
  }
  if (typeof raw === 'string') {
    if (byteLength(raw) > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('备份超过128 MB，请分开导入');
    try { raw = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw Error('请导入旧图片工坊下载的 jingben-backup.json'); }
  }
  if (!object(raw) || !object(raw.data)) throw Error('不是旧图片工坊的本人备份；需要 {at,user_id,data} 格式');
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at < 0) throw Error('备份缺少有效导出时间 at');
  return raw;
}

// Relation tables take precedence. In particular reverse/detail are ambiguous
// without an entity relation, so they must never be guessed into a category.
export function imageWorkshopKind(kind, category) {
  if (own(labels, category)) return {category, kind: labels[category], label: kindLabels[kind] || text(kind, '图片类型', 80)};
  let group = '';
  if (/^(front|side|back|expr_(neutral|smile|anger|stern|cry|sad|fear|provoke|stare|surprise|disgust|think))$/.test(kind)) group = 'characters';
  else if (/^(plan|view_[news]|establishing|wide|interior)$/.test(kind)) group = 'locations';
  else if (kind === 'hero') group = 'props';
  else if (kind === 'frame') group = 'storyboard';
  return group ? {category: group, kind: labels[group], label: kindLabels[kind]} : null;
}

function dimensions(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let mime = '', width = 0, height = 0;
  if (b.length >= 24 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10 && String.fromCharCode(...b.slice(12, 16)) === 'IHDR') {
    mime = 'image/png'; width = dv.getUint32(16); height = dv.getUint32(20);
  } else if (b.length >= 10 && /^GIF8[79]a$/.test(String.fromCharCode(...b.slice(0, 6)))) {
    mime = 'image/gif'; width = dv.getUint16(6, true); height = dv.getUint16(8, true);
  } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    mime = 'image/jpeg';
    let p = 2;
    while (p + 3 < b.length) {
      if (b[p++] !== 255) break;
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > b.length) break;
      const n = dv.getUint16(p);
      if (n < 2 || p + n > b.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && n >= 8) {
        height = dv.getUint16(p + 3); width = dv.getUint16(p + 5); break;
      }
      p += n;
    }
  } else if (b.length >= 30 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    mime = 'image/webp';
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === 'VP8X') {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (kind === 'VP8 ' && b[23] === 157 && b[24] === 1 && b[25] === 42) {
      width = dv.getUint16(26, true) & 0x3fff; height = dv.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && b[20] === 47) {
      width = 1 + b[21] + ((b[22] & 63) << 8);
      height = 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10);
    }
  }
  if (!mime || !width || !height || width > 32768 || height > 32768) return null;
  return {mime, width, height};
}

function privateHost(host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '::' || /\.(localhost|local|internal)$/.test(host) || /^(fc|fd|fe[89ab])[0-9a-f]*:/.test(host) || host.includes('::ffff:')) return true;
  const nums = host.split('.').map(Number);
  return nums.length === 4 && nums.every(Number.isInteger) && (nums[0] === 0 || nums[0] === 10 || nums[0] === 127 || nums[0] >= 224 || (nums[0] === 169 && nums[1] === 254) || (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) || (nums[0] === 192 && nums[1] === 168) || (nums[0] === 100 && nums[1] >= 64 && nums[1] <= 127));
}

function imageSource(raw) {
  if (typeof raw !== 'string' || !raw) return {src: '', available: false, sourceAccess: 'missing', reason: '备份没有这张图片的内容'};
  if (raw.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
    if (!match || match[2].length % 4 !== 0) return {src: '', available: false, sourceAccess: 'missing', reason: '内嵌图片格式无效，仅支持 PNG、JPEG、WebP、GIF'};
    if (Math.floor(match[2].length * 3 / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) > IMAGE_WORKSHOP_LIMITS.imageBytes) return {src: '', available: false, sourceAccess: 'missing', reason: '单张图片超过25 MB，请单独下载原图后上传'};
    let binary;
    try { binary = atob(match[2]); } catch { return {src: '', available: false, sourceAccess: 'missing', reason: '内嵌图片数据损坏'}; }
    const b = Uint8Array.from(binary, c => c.charCodeAt(0));
    const size = dimensions(b);
    if (!size || size.mime !== match[1].toLowerCase()) return {src: '', available: false, sourceAccess: 'missing', reason: '无法确认内嵌图片的格式或尺寸，请单独下载原图后上传'};
    return {src: raw, available: true, sourceAccess: 'embedded', width: size.width, height: size.height};
  }
  if (raw.startsWith('file:')) return {src: '', available: false, sourceAccess: 'missing', reason: '旧站未能展开本地原图，请登录旧站下载这张图片后上传'};
  let u;
  try { u = new URL(raw); } catch { return {src: '', available: false, sourceAccess: 'missing', reason: '原图链接无效'}; }
  if (u.protocol !== 'https:' || u.username || u.password || privateHost(u.hostname)) return {src: '', available: false, sourceAccess: 'missing', reason: '原图链接不符合导入要求，请下载原图后上传'};
  if ([...u.searchParams.keys()].some(k => /^(access|access[_-]?token|token|oauth[_-]?token|api[_-]?key|key|auth|auth[_-]?token|authorization|password|session|session[_-]?id|jwt|bearer|credential|signature|x-amz-(signature|security-token|credential)|x-goog-(signature|credential)|awsaccesskeyid)$/i.test(k))) return {src: '', available: false, sourceAccess: 'missing', reason: '原图链接包含登录或临时授权参数，请下载原图后上传'};
  return {src: raw, available: true, sourceAccess: 'remote'};
}


// Copy an explicit creative allowlist only. Entity relations never carry member
// rows, ownership declarations, credentials, permissions, or provider routing.
function sourceEntity(row, name) {
  const fieldMap = {description:'description',role:'role',identityRegion:'identity_region',age:'age',gender:'gender',appearance:'appearance',costume:'costume',material:'material',usedBy:'used_by',heading:'heading',timeOfDay:'time_of_day',weather:'weather',atmosphere:'atmosphere',worldAnchors:'world_lock',extraPrompt:'extra_prompt'};
  const fields = {};
  for(const [target,key] of Object.entries(fieldMap)) if(typeof row[key]==='string') fields[target]=text(row[key],'原素材设定');
  return {id:text(row.id,'原素材编号',256),name,fields};
}
function ownedIndex(list, owner, warnings, label) {
  const map = new Map(), duplicate = new Set();
  for (const row of list) {
    if (row.user_id !== owner || typeof row.id !== 'string' || !row.id || duplicate.has(row.id)) continue;
    if (map.has(row.id)) {map.delete(row.id); duplicate.add(row.id); warnings.push(`${label}存在重复编号，未使用有歧义的关联信息`);}
    else map.set(row.id, row);
  }
  return map;
}

/** Parse only creative image fields locally. No identity, credential, provider,
 * member, billing, generation job, or public/share permission is adopted. */
export function inspectImageWorkshopImport(raw, options = {}) {
  const backup = parse(raw), sourceOwnerId = id(backup.user_id, '备份本人标识');
  if (options.expectedSourceOwnerId !== undefined && options.expectedSourceOwnerId !== sourceOwnerId) throw Error('备份声明的原站账号与预期账号不一致，未导入');
  const warnings = ['本地文件仅声明原站归属，尚未远程核验；请只选择自己有权迁移的图片。'];
  const data = backup.data, images = rows(data, 'jingben_images', true);
  const projects = ownedIndex(rows(data, 'jingben_projects'), sourceOwnerId, warnings, '作品');
  const episodes = ownedIndex(rows(data, 'jingben_episodes'), sourceOwnerId, warnings, '分集');
  const entities = Object.fromEntries(Object.entries(entityTables).map(([category, table]) => [category, ownedIndex(rows(data, table), sourceOwnerId, warnings, labels[category])]));
  const seen = new Set(), candidates = [], unavailable = [];
  let pickedBytes = 0;
  for (const row of images) {
    const originalId = id(row.id, '原图片编号');
    const sourceId = `image-workshop:${encodeURIComponent(originalId)}`;
    if (seen.has(sourceId)) throw Error('备份有重复的图片编号，请先核对；没有导入任何图片');
    seen.add(sourceId);
    if (row.user_id !== sourceOwnerId) {
      unavailable.push({sourceId, name: '归属不一致的记录', reason: '图片归属字段与备份本人标识不一致，未读取创作内容'});
      continue;
    }
    pickedBytes += byteLength(typeof row.image_url === 'string' ? row.image_url : '') + byteLength(typeof row.prompt === 'string' ? row.prompt : '');
    if (pickedBytes > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('图片内容超过128 MB，请分开导入；没有导入任何图片');
    const sourceKind = text(row.kind, '原图片类型', 80);
    const projectId = text(row.project_id, '原作品编号', 256);
    const episodeId = text(row.episode_id, '原分集编号', 256);
    const entityId = text(row.entity_id, '原素材编号', 256);
    const project = projects.get(projectId), ep = episodes.get(episodeId);
    const episode = ep && ep.project_id === projectId ? ep : null;
    const related = Object.entries(entities).flatMap(([category, index]) => {
      const row = index.get(entityId);
      return row && row.project_id === projectId && (row.scope === 'series' || row.episode_id === episodeId) ? [{category, row}] : [];
    });
    const relation = related.length === 1 ? related[0] : null;
    const mapped = imageWorkshopKind(sourceKind, relation?.category);
    if (!mapped) {
      unavailable.push({sourceId, name: '未分类图片', sourceKind, reason: '缺少明确的素材关联，无法确定角色、场景、道具或分镜类型；请单独下载原图后上传'});
      continue;
    }
    const entityName = relation ? mapped.category === 'storyboard'
      ? `镜头 ${Number.isSafeInteger(relation.row.seq) && relation.row.seq > 0 ? relation.row.seq : ''}`.trim()
      : text(relation.row.name, '素材名称', 500) : '';
    const src = imageSource(row.image_url);
    const candidate = {
      sourceId, name: [entityName || mapped.kind, mapped.label].filter(Boolean).join(' · '),
      kind: mapped.kind, category: mapped.category, sourceKind,...(relation?{sourceEntity:sourceEntity(relation.row,entityName)}:{}),
      prompt: text(row.prompt, '原图片提示词'), ...src,
      sourceProjectTitle: project ? text(project.title, '原作品名称', 500) : '',
      sourceEpisode: episode ? [Number.isSafeInteger(episode.ep_no) && episode.ep_no > 0 ? `第${episode.ep_no}集` : '', text(episode.title, '原分集名称', 500)].filter(Boolean).join(' · ') : '',
      sourceCreated: text(row.created_at, '原图片创建时间', 100),
      projectMeta: {
        sourceProjectId: projectId, sourceEpisodeId: episodeId,
        title: project ? text(project.title, '原作品名称', 500) : '',
        visualStyle: project ? text(project.visual_style, '原作品视觉风格', 2000) : '',
        episodeTitle: episode ? text(episode.title, '原分集名称', 500) : '',
        ...(episode && Number.isSafeInteger(episode.ep_no) && episode.ep_no > 0 ? {episodeNumber: episode.ep_no} : {}),
      },
      scope: ['series','episode'].includes(relation?.row.scope) ? relation.row.scope : row.scope === 'series' ? 'series' : 'episode',
    };
    candidates.push(candidate);
  }
  if (candidates.some(c => c.sourceAccess === 'remote')) warnings.push('远程原图尚未迁入；链接可能过期或限制跨站读取，读取失败的图片应单独下载后上传。');
  if (candidates.some(c => !c.available) || unavailable.length) warnings.push('有记录尚不可迁移，请查看未迁移原因；没有用占位图代替原图。');
  const result = freeze({format: 'jingben-user-backup-v1', sourceOwnerId, sourceExportedAt: backup.at, candidates, unavailable, warnings, total: images.length});
  records.set(result, {candidates, unavailable, warnings});
  return result;
}

/** Returns only an explicit selection. The caller must still decode/copy remote
 * bytes and report individual failures before claiming migration succeeded. */
export function selectImageWorkshopImport(preview, options = {}) {
  const inspected = records.get(preview);
  if (!inspected) throw Error('请先检查本人图片备份，再选择要导入的图片');
  if (options.confirmOwnImages !== true) throw Error('请确认所选图片属于本人或已获得迁移授权');
  if (!Array.isArray(options.selectedSourceIds) || !options.selectedSourceIds.length || options.selectedSourceIds.some(s => typeof s !== 'string')) throw Error('请明确选择要导入的图片');
  if (new Set(options.selectedSourceIds).size !== options.selectedSourceIds.length) throw Error('选择列表包含重复图片');
  const all = new Map([...inspected.candidates, ...inspected.unavailable].map(c => [c.sourceId, c]));
  const assets = [], unavailable = [];
  for (const sourceId of options.selectedSourceIds) {
    const c = all.get(sourceId);
    if (!c) throw Error('选择列表包含未检查的图片，未导入');
    if (!c.available) {unavailable.push({sourceId, name: c.name, reason: c.reason || '原图尚不可迁移'}); continue;}
    const out = {};
    for (const key of ['sourceId','name','kind','category','sourceKind','prompt','src','width','height','sourceAccess','sourceProjectTitle','sourceEpisode','sourceCreated','scope']) if (own(c, key)) out[key] = c[key];
    out.projectMeta = {...c.projectMeta};
    if(c.sourceEntity)out.sourceEntity={...c.sourceEntity,fields:{...c.sourceEntity.fields}};
    assets.push(out);
  }
  return {format: 'image-workshop-selection-v1', assets, unavailable, warnings: [...inspected.warnings]};
}

function crc32(b) {
  let crc = 0xffffffff;
  for (const n of b) {crc ^= n; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(payload, limit) {
  let stream;
  try {stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}
  catch {throw Error('此浏览器无法解开这种ZIP，请解压后直接选择 jingben-backup.json');}
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit || size > IMAGE_WORKSHOP_LIMITS.bytes) {await reader.cancel(); throw Error('ZIP解压内容超过限制，请直接导入JSON');}
      chunks.push(value);
    }
  } catch (e) {if (String(e?.message).includes('超过限制')) throw e; throw Error('ZIP内容损坏，请解压后直接选择JSON');}
  const b = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {b.set(chunk, offset); offset += chunk.byteLength;}
  return b;
}

/** The old app exports JSON, not a media ZIP. For convenience a ZIP may wrap
 * exactly that real JSON backup. Other archive schemas/media paths are not
 * invented or followed. No file is extracted to disk or fetched over network. */
export async function readImageWorkshopArchive(input, options = {}) {
  if (input && typeof input.arrayBuffer === 'function') {
    if (input.size > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('备份超过128 MB，请分开导入');
    input = await input.arrayBuffer();
  }
  const b = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!b) return inspectImageWorkshopImport(input, options);
  if (b.byteLength > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('备份超过128 MB，请分开导入');
  if (!(b[0] === 80 && b[1] === 75)) return inspectImageWorkshopImport(b, options);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--) if (dv.getUint32(p, true) === 0x06054b50 && p + 22 + dv.getUint16(p + 20, true) === b.length) {end = p; break;}
  if (end < 0) throw Error('ZIP目录损坏，请直接导入JSON');
  const count = dv.getUint16(end + 10, true), cdSize = dv.getUint32(end + 12, true), cd = dv.getUint32(end + 16, true);
  if (dv.getUint16(end + 4, true) || dv.getUint16(end + 6, true) || dv.getUint16(end + 8, true) !== count || !count || count > IMAGE_WORKSHOP_LIMITS.archiveEntries || cd === 0xffffffff || cdSize === 0xffffffff || cd + cdSize !== end) throw Error('ZIP格式不受支持，请直接导入本人JSON备份');
  const entries = [], seen = new Set();
  let p = cd, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || dv.getUint32(p, true) !== 0x02014b50) throw Error('ZIP目录损坏');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), compressed = dv.getUint32(p + 20, true);
    const n = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), offset = dv.getUint32(p + 42, true);
    if (p + 46 + n + extra + comment > end || flags & 1 || ![0,8].includes(method) || [size, compressed, offset].includes(0xffffffff) || dv.getUint16(p + 34, true)) throw Error('ZIP包含不受支持的加密或分卷内容');
    let path;
    try {path = new TextDecoder('utf-8', {fatal: true}).decode(b.slice(p + 46, p + 46 + n));} catch {throw Error('ZIP文件名编码无效');}
    if (!path || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(s => s === '..' || s === '.') || /[\u0000-\u001f]/.test(path) || seen.has(path)) throw Error('ZIP路径不安全或重复，未读取内容');
    seen.add(path); total += size;
    if (size > IMAGE_WORKSHOP_LIMITS.bytes || total > IMAGE_WORKSHOP_LIMITS.bytes) throw Error('ZIP解压内容超过128 MB');
    if (/\.json$/i.test(path)) entries.push({path, flags, method, crc, size, compressed, offset});
    p += 46 + n + extra + comment;
  }
  if (p !== end) throw Error('ZIP目录长度无效');
  const named = entries.filter(e => e.path.split('/').pop() === 'jingben-backup.json');
  const entry = named.length === 1 ? named[0] : !named.length && entries.length === 1 ? entries[0] : null;
  if (!entry) throw Error('ZIP中需要唯一的 jingben-backup.json，请解压后直接选择本人备份JSON');
  const q = entry.offset;
  if (q + 30 > cd || dv.getUint32(q, true) !== 0x04034b50 || dv.getUint16(q + 6, true) !== entry.flags || dv.getUint16(q + 8, true) !== entry.method) throw Error('ZIP内容头与目录不一致');
  const nameSize = dv.getUint16(q + 26, true), extraSize = dv.getUint16(q + 28, true), begin = q + 30 + nameSize + extraSize;
  if (begin > cd || begin + entry.compressed > cd) throw Error('ZIP内容超出目录范围');
  let localPath;
  try {localPath = new TextDecoder('utf-8', {fatal: true}).decode(b.slice(q + 30, q + 30 + nameSize));} catch {throw Error('ZIP文件名编码无效');}
  if (localPath !== entry.path) throw Error('ZIP内容文件名与目录不一致');
  const packed = b.slice(begin, begin + entry.compressed), unpacked = entry.method === 0 ? packed : await inflate(packed, entry.size);
  if (unpacked.byteLength !== entry.size || crc32(unpacked) !== entry.crc) throw Error('ZIP内容校验失败，请重新下载备份');
  return inspectImageWorkshopImport(unpacked, options);
}

const aspects = new Set(['16:9','9:16','1:1','3:4','4:3','4:5','2:3','3:2']);
const charViews = {
  front: '正面站姿，中大腿以上，面向镜头，双臂自然放松。',
  side: '完整侧面轮廓，朝左，中大腿以上，服装和发型保持一致。',
  back: '背面站姿，中大腿以上，呈现同一外套、发型和背部轮廓。',
  expr_smile: '微笑：眼角收紧、面颊抬起，眼神与嘴角同时表达笑意。',
  expr_anger: '愤怒：眉间收紧、眼睑紧张、鼻翼轻张，嘴唇紧抿或咬牙。',
  expr_stern: '严肃：平眉、闭口、不微笑、目光稳定，沉着而非愤怒。',
  expr_cry: '哭泣：湿润眼眶、发红眼睑、可见泪痕，嘴唇轻颤，避免夸张嚎哭。',
  expr_sad: '悲伤：内眉抬起收拢、眼睑沉重、嘴角向下，克制的失落。',
  expr_fear: '恐惧：眉毛抬起收拢、上眼睑抬高、嘴唇微张，面部保持紧绷。',
  expr_provoke: '挑衅：下巴微向前、单眉轻挑或克制冷笑，目光直视镜头。',
  expr_stare: '凝视：持续直视镜头，面部其余部分平静，力度集中在瞳孔。',
};
const cameraViews = {view_n: '相机位于北侧，朝南拍摄', view_w: '相机位于西侧，朝东拍摄', view_e: '相机位于东侧，朝西拍摄', view_s: '相机位于南侧，朝北拍摄'};

/** Four focused production-still templates adapted from jobPrompt, not a script
 * parser. User action/dialogue are inserted verbatim and never rewritten. */
export function buildImageWorkshopPrompt(category, fields = {}) {
  category = IMAGE_WORKSHOP_CATEGORIES.find(c => c.id === category || c.label === category)?.id;
  if (!category || !object(fields)) throw Error('请选择角色、场景、道具或分镜');
  const field = (key, fallback = '') => text(fields[key], `创作参数 ${key}`, IMAGE_WORKSHOP_LIMITS.text, fallback);
  const kind = field('kind', category === 'characters' ? 'front' : category === 'locations' ? 'view_n' : category === 'props' ? 'hero' : 'frame');
  const defaultAspect = category === 'characters' ? kind.startsWith('expr_') ? '1:1' : '3:4' : category === 'locations' && kind === 'plan' ? '1:1' : '16:9';
  const aspect = field('aspect', defaultAspect);
  if (!aspects.has(aspect)) throw Error('图片画幅无效');
  const refCount = fields.referenceCount ?? 0;
  if (!Number.isSafeInteger(refCount) || refCount < 0 || refCount > 3) throw Error('参考图数量需为0–3');
  const lock = fields.referenceIdentity !== false && refCount > 0;
  const referenceHints = refCount ? [lock ? '固定参考图中的人物身份、面部、发型、年龄、肤色与服装；场景结构和道具外观保持连续。' : '将参考图用于用户指定的构图或风格，不擅自改变剧本内容。'] : [];
  const parts = [`${aspect} 完整画幅，不加黑边，不做拼贴或多格图。`];
  const name = field('name'), description = field('description');
  if (category === 'characters') {
    parts.push('单人角色定妆照，整个画面只有一人，没有第二张脸、倒影或人群。', `人物身份：${[name, field('role')].filter(Boolean).join(' · ') || '剧本角色'}；姓名和职业只用于理解身份，不能印在服装上。`, `外貌：${[field('identityRegion', '中国 / 东亚面孔'), field('age'), field('gender'), field('appearance'), description].filter(Boolean).join('，')}。`, field('costume') ? `服装：${field('costume')}。` : '', charViews[kind] || field('view', '自然站姿，面向镜头。'), kind.startsWith('expr_') ? '头肩近景；眼睛、眼睑、眉毛、面颊和嘴部一起呈现真实细微表情，避免面具感。' : '', '浅灰无缝摄影棚背景，柔和均匀布光，背景不放街道、家具或其他人物。');
    if (lock) parts.push('严格固定参考图人物身份，只改变指定视角或表情；不能换脸、换年龄、换发型或换服装。');
    parts.push(wardrobeLockPrompt({kind, costume: field('costume'), hasFrontRef: isCharacterFollowKind(kind) && refCount > 0}));
    parts.push('Single character turnaround still. Bible identity stays on this one person; no collage, no second face.');
    parts.push('服装、徽章和证件只用空白或通用无字图形，不生成姓名、编号、英文标识或可读文字。');
  } else if (category === 'locations') {
    parts.push(`场景：${[field('heading'), name, description].filter(Boolean).join('；') || '剧本指定空间'}。`, `时间、天气、气氛：${[field('timeOfDay'), field('weather'), field('atmosphere')].filter(Boolean).join('，') || '依照剧本'}。`, '只使用剧本或参考图明确出现的建筑与物件，不新增门、床、道路、泳池或多余家具。');
    if (kind === 'plan') parts.push('真正的正交垂直俯视白模，镜头无限高并垂直朝下；北为画面上方，西为左，东为右。墙体、门窗开口、家具块体的位置与数量固定，不使用斜俯视，不放人物或坐标轴。');
    else parts.push(`${cameraViews[kind] || field('view', '按选定机位拍摄')}；方位属于固定世界坐标，不能按画面左右重新布置空间。`, '呈现完成美术置景的真实空场景；白模只作结构参考，不把成图变成灰色未贴图模型。');
    if (field('worldAnchors')) parts.push(`固定空间锚点：${field('worldAnchors')}`);
    if (lock) parts.push('保持参考图墙体、门窗、家具的数量和位置，不镜像、不更换空间。');
  } else if (category === 'props') {
    parts.push(`电影道具产品照：${name || '剧本指定道具'}。`, description, field('material') ? `材质、磨损与年代痕迹：${field('material')}。` : '', field('usedBy') ? `使用者：${field('usedBy')}。` : '', '将道具单独置于安静的摄影棚台面，突出可辨认的外形、比例和材质，不新增人物或品牌。');
    if (lock) parts.push('严格沿用参考图道具的外形、材质、颜色与设计语言。');
  } else {
    parts.push('单张电影分镜剧照，保留剧本原有动作与先后关系，不将不同时间的动作拼在同一画面。', field('scene') ? `场次：${field('scene')}` : '', field('action') ? `画面动作：${field('action')}` : description, field('characters') ? `画面人物：${field('characters')}；只出现所列人物，不增加群众。` : '人物依照剧本设定，未另行指定时采用中国 / 东亚面孔。', field('props') ? `道具：${field('props')}` : '', field('dialogue') ? `此刻说出的台词（只用于表演，不渲染文字）：${field('dialogue')}` : '', [field('shotSize'), field('composition'), field('cameraMove'), field('lighting'), field('technique')].filter(Boolean).join('；'));
    if (kind === 'reverse') parts.push('反打覆盖镜头：遵守180度轴线规则，在对话轴线同一侧切换正反打机位，被拍正脸与前景肩膀的角色互换，不重复主机位；保持人物朝向、视线与固定空间关系。');
    if (field('continuity')) parts.push(`连续性约束：${field('continuity')}`);
    if (lock) parts.push('使用参考图保持人物身份、服装、场景和道具一致，只改变剧本规定的动作与机位。');
    parts.push('SCENE IS FROZEN. Copy walls, furniture, openings, and lighting from the empty location plate / 360 panorama. Add or replace ONLY the people.');
  }
  if (field('style') || field('visualStyle') || field('styleLock')) parts.push(`视觉风格：${[field('style'), field('visualStyle'), field('styleLock')].filter(Boolean).join('；')}`);
  else if (!(category === 'locations' && kind === 'plan')) parts.push('真实影视摄影质感，可信的皮肤、布料、材质和光线。');
  if (field('extraPrompt')) parts.push(`补充要求：${field('extraPrompt')}`);
  parts.push('画面不出现字幕、说明牌、水印、品牌标志或其他可读文字。');
  return {category, kind: labels[category], sourceKind: kind, aspect, prompt: parts.filter(Boolean).join('\n'), referenceHints};
}
