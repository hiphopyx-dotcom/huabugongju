import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {PACK_LIMITS, clipSkillText, extractSkillPack, mergeSkillPrompt, parseSkillFiles, readZip, suggestCategory} from '../pages/skill-import.mjs';

function crc32(bytes) {
  let crc = ~0;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { n >>>= 0; return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function zip(entries, method = 0) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const raw = new TextEncoder().encode(entry.text);
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...name, ...data];
    locals.push(...local);
    centrals.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
    offset += local.length;
  }
  const centralOffset = locals.length;
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(centrals.length), ...u32(centralOffset), ...u16(0)];
  return new Uint8Array([...locals, ...centrals, ...end]);
}
const skill = (body = '打斗用剑。', extra = {}) => ({name: 'SKILL.md', path: 'SKILL.md', text: `---\nname: 试招\ndescription: 一套打戏提示\n---\n${body}`, ...extra});

test('1500 字上限按字截断，并保留文末禁止项', () => {
  const tail = '【禁止项】\n禁止：多出手脚。';
  const packed = '剑'.repeat(2000) + tail;
  const clipped = clipSkillText(packed);
  assert.equal(clipped.truncated, true);
  assert.ok(Array.from(clipped.text).length <= 1500);
  assert.ok(clipped.text.endsWith(tail));
  assert.match(clipped.text, /已截断/);
  const short = clipSkillText('刚好');
  assert.equal(short.truncated, false);
  assert.equal(short.text, '刚好');
  assert.equal(mergeSkillPrompt(['原提示'], '技能', false), '原提示');
  assert.equal(mergeSkillPrompt(['原提示', ''], '', true), '原提示');
});

test('分类由关键词建议，打戏技能文件识别为打戏', async () => {
  assert.equal(suggestCategory('这是一套剑法打斗').id, 'fight');
  assert.equal(suggestCategory('只讲运镜和机位').id, 'camera');
  assert.equal(suggestCategory('舞蹈编舞').id, 'dance');
  assert.equal(suggestCategory('情绪和表情').id, 'emotion');
  assert.equal(suggestCategory('没有关键词').id, 'other');
  const parsed = parseSkillFiles([{path: 'SKILL.md', text: fs.readFileSync(new URL('../pages/skills/fight.md', import.meta.url), 'utf8')}]);
  assert.equal(parsed.category, 'fight');
  assert.deepEqual(parsed.stages, ['video']);
  assert.equal(parsed.name, '打戏');
});

test('非 Markdown 被丢弃，路径穿越和超量被拒绝', async () => {
  const parsed = await extractSkillPack({files: [skill(), {path: 'notes.js', text: 'alert(1)'}, {path: 'pic.png', text: 'not-text'}, {path: 'extra/readme.md', text: '参考'}]});
  assert.deepEqual(parsed.dropped.sort(), ['notes.js', 'pic.png']);
  assert.equal(parsed.references.length, 1);
  await assert.rejects(() => extractSkillPack({files: [{path: '../SKILL.md', text: 'x'}]}), /不安全/);
  await assert.rejects(() => extractSkillPack({files: [{path: 'readme.md', text: '没有技能文件'}]}), /SKILL\.md/);
  const huge = 'a'.repeat(PACK_LIMITS.markdownBytes + 1);
  assert.throws(() => parseSkillFiles([skill(huge)]), /200KB/);
  const many = [skill(), ...Array.from({length: 30}, (_, i) => ({path: `n${i}.txt`, text: 'x'}))];
  assert.throws(() => parseSkillFiles(many), /30/);
});

test('zip 防路径穿越，解包上限和 deflate 都能拦住或读出', async () => {
  const good = await readZip(zip([skill(), {name: 'run.js', text: 'process.exit(1)'}]));
  const parsed = parseSkillFiles(good.map(file => ({path: file.path, text: new TextDecoder().decode(file.bytes)})));
  assert.equal(parsed.dropped.includes('run.js'), true);
  await assert.rejects(() => readZip(zip([{name: '../secret.md', text: 'x'}])), /不安全/);
  await assert.rejects(() => readZip(zip([{name: '/etc/passwd', text: 'x'}])), /不安全/);
  const deflated = await readZip(zip([skill('刀剑出招')], 8));
  assert.match(new TextDecoder().decode(deflated[0].bytes), /刀剑出招/);
  const claimed = zip([{name: 'SKILL.md', text: '---\nname: 小\ndescription: 小\n---\n正文'}]);
  const view = new DataView(claimed.buffer, claimed.byteOffset, claimed.byteLength);
  view.setUint32(22, PACK_LIMITS.unpackedBytes + 1, true);
  await assert.rejects(() => readZip(claimed), /5MB/);
  const oversized = new Uint8Array(PACK_LIMITS.zipBytes + 1);
  await assert.rejects(() => readZip(oversized), /2MB/);
});
