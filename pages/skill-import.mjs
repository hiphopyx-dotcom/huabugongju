// 技能包只提取 Markdown 文字。不执行脚本，不把文件写进磁盘。
export const PACK_LIMITS = {
  zipBytes: 2 * 1024 * 1024,
  unpackedBytes: 5 * 1024 * 1024,
  files: 30,
  markdownBytes: 200 * 1024,
};
export const SKILL_CHAR_LIMIT = 1500;
export const CATEGORIES = [
  {id:'fight', label:'打戏', words:['打斗','打戏','格斗','武打','武侠','剑','拳','刀','武器','出招','刺客','击中']},
  {id:'camera', label:'运镜', words:['运镜','机位','推拉','摇移','跟拍','镜头运动']},
  {id:'dance', label:'舞蹈', words:['舞蹈','舞步','编舞']},
  {id:'emotion', label:'情绪', words:['情绪','表情','情感']},
];
export const CATEGORY_IDS = [...CATEGORIES.map(item => item.id), 'other'];
export const STAGES = [
  {id:'video', label:'视频'},
  {id:'storyboard', label:'分镜'},
  {id:'image', label:'生图'},
];
const CATEGORY_LABEL = Object.fromEntries([...CATEGORIES.map(item => [item.id, item.label]), ['other', '其他']]);

export function categoryLabel(id) { return CATEGORY_LABEL[id] || '其他'; }

export function clipSkillText(text, limit = SKILL_CHAR_LIMIT) {
  const src = String(text ?? '');
  const chars = Array.from(src);
  if (chars.length <= limit) return {text: src, truncated: false, limit};
  const notice = '（超出 1500 字，已截断）';
  const marker = '【禁止项】';
  const at = src.lastIndexOf(marker);
  if (at >= 0) {
    const tail = src.slice(at);
    const room = limit - Array.from(tail).length - Array.from(notice).length;
    if (room >= 20) return {text: Array.from(src.slice(0, at)).slice(0, room).join('') + notice + tail, truncated: true, limit};
  }
  const room = limit - Array.from(notice).length;
  return {text: chars.slice(0, Math.max(0, room)).join('') + notice, truncated: true, limit};
}

export function mergeSkillPrompt(parts, skillText, enabled) {
  const base = (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join('\n\n');
  if (!enabled || !skillText) return base;
  const clipped = clipSkillText(skillText);
  if (!clipped.text || base.includes(clipped.text)) return base;
  return [base, clipped.text].filter(Boolean).join('\n\n');
}

export function safeRelPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return '';
  const slash = name.replace(/\\/g, '/');
  if (slash.startsWith('/') || /^[A-Za-z]:/.test(slash)) return '';
  const parts = [];
  for (const part of slash.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return '';
    parts.push(part);
  }
  return parts.join('/');
}

function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function u32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function crc32(bytes) {
  let crc = ~0;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(input, inflate = inflateRaw) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > PACK_LIMITS.zipBytes) throw Error('压缩包超过 2MB');
  const files = [];
  let offset = 0;
  let unpacked = 0;
  while (offset + 30 <= bytes.length) {
    const signature = u32(bytes, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw Error('压缩包格式无法识别');
    const flags = u16(bytes, offset + 6);
    const method = u16(bytes, offset + 8);
    const crc = u32(bytes, offset + 14);
    const compressedSize = u32(bytes, offset + 18);
    const uncompressedSize = u32(bytes, offset + 22);
    const nameLength = u16(bytes, offset + 26);
    const extraLength = u16(bytes, offset + 28);
    const nameStart = offset + 30;
    if (nameStart + nameLength + extraLength > bytes.length) throw Error('压缩包不完整');
    const name = new TextDecoder('utf-8', {fatal: false}).decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    if (flags & 1) throw Error('不支持加密压缩包');
    if (flags & 8) throw Error('请用不带数据描述符的方式重新打包');
    if (dataStart + compressedSize > bytes.length) throw Error('压缩包不完整');
    const path = safeRelPath(name);
    if (!path) throw Error('压缩包路径不安全');
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
    if (name.endsWith('/')) continue;
    if (uncompressedSize > PACK_LIMITS.unpackedBytes) throw Error('解压后超过 5MB');
    if (files.length >= PACK_LIMITS.files) throw Error('压缩包超过 30 个文件');
    let raw;
    if (method === 0) raw = new Uint8Array(data);
    else if (method === 8) raw = new Uint8Array(await inflate(data));
    else throw Error('压缩包使用了不支持的压缩方式');
    if (raw.length > PACK_LIMITS.unpackedBytes || unpacked + raw.length > PACK_LIMITS.unpackedBytes) throw Error('解压后超过 5MB');
    if (crc && crc32(raw) !== crc) throw Error('压缩包校验失败');
    unpacked += raw.length;
    files.push({path, bytes: raw});
  }
  if (!files.length && offset === 0) throw Error('压缩包是空的');
  return files;
}

function textSize(text) { return new TextEncoder().encode(String(text ?? '')).length; }

export function suggestCategory(text) {
  const source = String(text ?? '');
  let best = {id:'other', score:0, tied:false};
  for (const category of CATEGORIES) {
    const score = category.words.reduce((n, word) => n + (source.includes(word) ? 1 : 0), 0);
    if (score > best.score) best = {id:category.id, score, tied:false};
    else if (score > 0 && score === best.score) best = {...best, id:'other', tied:true};
  }
  return {id: best.score ? best.id : 'other', label: categoryLabel(best.score ? best.id : 'other')};
}

export function suggestStages() { return ['video']; }

function parseFrontMatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  let body = source;
  if (match) {
    body = source.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!meta.name) {
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) meta.name = heading[1].trim();
  }
  if (!meta.description) {
    const line = body.split(/\r?\n/).map(item => item.trim()).find(item => item && !item.startsWith('#'));
    meta.description = line || '';
  }
  const name = String(meta.name || '').trim();
  if (!name) throw Error('SKILL.md 开头需要写名称 name');
  return {name: name.slice(0, 80), description: String(meta.description || '').trim().slice(0, 500), body: body.trim()};
}

function keepMarkdown(entries) {
  if (entries.length > PACK_LIMITS.files) throw Error('最多 30 个文件');
  const kept = [];
  const dropped = [];
  let unpacked = 0;
  for (const entry of entries) {
    const path = safeRelPath(entry.path);
    if (!path) throw Error('文件路径不安全');
    const text = String(entry.text ?? '');
    const size = textSize(text);
    unpacked += size;
    if (unpacked > PACK_LIMITS.unpackedBytes) throw Error('解压后超过 5MB');
    if (!path.toLowerCase().endsWith('.md')) {
      dropped.push(path);
      continue;
    }
    if (size > PACK_LIMITS.markdownBytes) throw Error('单个说明文件超过 200KB');
    kept.push({path, text});
  }
  return {kept, dropped};
}

export function parseSkillFiles(entries) {
  const {kept, dropped} = keepMarkdown(entries);
  const skills = kept.filter(file => /(^|\/)skill\.md$/i.test(file.path));
  if (skills.length !== 1) throw Error('需要恰好一份 SKILL.md');
  const skill = parseFrontMatter(skills[0].text);
  const folder = skills[0].path.includes('/') ? skills[0].path.slice(0, skills[0].path.lastIndexOf('/') + 1) : '';
  const references = kept.filter(file => file !== skills[0] && file.path.startsWith(folder));
  const corpus = [skill.name, skill.description, skill.body, ...references.map(file => file.text)].join('\n');
  const category = suggestCategory(corpus);
  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    references,
    category: category.id,
    categoryLabel: category.label,
    stages: suggestStages(),
    dropped,
    warnings: dropped.length ? [`已丢弃非 Markdown 文件：${dropped.join('、')}`] : [],
  };
}

export async function extractSkillPack(input = {}) {
  if (input.zipBytes) {
    const raws = await readZip(input.zipBytes);
    const entries = raws.map(file => ({path: file.path, text: new TextDecoder('utf-8', {fatal: false}).decode(file.bytes)}));
    return parseSkillFiles(entries);
  }
  if (!Array.isArray(input.files)) throw Error('请选择技能文件夹或 zip');
  return parseSkillFiles(input.files);
}

export function normalizeCategory(value) {
  const text = String(value || '').trim();
  const byLabel = Object.entries(CATEGORY_LABEL).find(([, label]) => label === text);
  const id = byLabel ? byLabel[0] : text;
  if (!CATEGORY_IDS.includes(id)) throw Error('请确认技能分类');
  return id;
}
export function normalizeStages(value) {
  const source = Array.isArray(value) ? value : String(value || 'video').split(',');
  const picked = [...new Set(source.map(item => String(item || '').trim()).filter(item => STAGES.some(stage => stage.id === item)))];
  return picked.length ? picked : ['video'];
}
