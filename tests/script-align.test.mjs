import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {splitEpisodes as fenjingSplit} from './fixtures/fenjing-split.mjs';
import {bytesToScript as fenjingBytes} from './fixtures/fenjing-read.mjs';
import {splitEpisodes, breakScript, characterBible} from '../public/studio/pianchang-parse.mjs';
import {scriptEpisodes} from '../public/studio/pianchang-core.mjs';
import {readScript, wordXmlToText} from '../public/studio/script-breakdown.mjs';
import {normalizeParseAssets, parseAssetsPrompt} from '../public/studio/parse-assets.mjs';
import {normalizeParseAssets as fenjingNormalize} from './fixtures/fenjing-normalize.mjs';

const script = readFileSync(new URL('./fixtures/scripts/two-episodes.txt', import.meta.url), 'utf8');

function zipDocx(xml) {
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from(xml);
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
  const offset = local.length + name.length + data.length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function docxXml(text) {
  const body = text.replace(/\r\n/g, '\n').split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:document>`;
}

const docxPath = new URL('./fixtures/scripts/two-episodes.docx', import.meta.url);
const docxBytes = zipDocx(docxXml(script));
writeFileSync(docxPath, docxBytes);

function summarize(text) {
  const parts = fenjingSplit(text);
  return parts.map(part => {
    const parsed = breakScript(part.script.includes('人物小传') ? part.script : `${characterBibleBlock(text)}\n${part.script}`);
    const bibleNames = new Set(characterBible(text).map(item => item.name));
    return {
      title: part.title,
      characters: parsed.characters.map(item => ({name: item.name, fromBible: bibleNames.has(item.name) && Boolean(item.appearance), appearance: item.appearance})),
      locations: parsed.locations.map(item => item.name),
      props: parsed.props.map(item => item.name),
      beats: parsed.beats.length,
    };
  });
}

function characterBibleBlock(text) {
  const at = text.search(/人物小传/);
  const shoot = text.search(/(?:^|\n)第/);
  if (at < 0) return '';
  return text.slice(at, shoot > at ? shoot : undefined);
}

const edges = {
  '无集标记': '1-1 日 内 门房\n人物：阿青\n△阿青进门。',
  '中文数字': '第一集\n1-1 日 内 门房\n△进门。\n第二集\n2-1 夜 外 江边\n△停下。',
  '场次写在集标题前且标题后没有场号': '1-1 夜 外 江滩\n△凯恩看着江。\n第二集 只有标题\n正文说明，没有紧跟场号。',
  '序章没有集标记': '序章\n外景 江滩\n△凯恩看着江面。',
  '过长梗概不算集标题': '第1集：这是一段超过四十个字的梗概，里面有句号。所以这一行不是集标题，后面也没有场次。\n正文仍算一整集。',
  '重复集号留更长的一集': '第1集\n1-1 日 内 短\n△短。\n第1集\n1-1 日 内 长场\n人物：阿青\n△阿青把整段故事又讲了一遍，这一集更长。',
  '全角数字与两': '第２集\n2-1 日 内 甲\n△甲。\n第两集\n2-1 日 内 乙\n△乙把这段写得更长一些。',
};

test('分集与分镜站 splitEpisodes 一致，包括边界情况', () => {
  const samples = {正片: script, ...edges};
  for (const [name, text] of Object.entries(samples)) {
    const theirs = fenjingSplit(text).map(part => ({title: part.title, script: part.script}));
    const ours = splitEpisodes(text).map(part => ({title: part.title, script: part.script}));
    assert.deepEqual(ours, theirs, name);
    assert.deepEqual(scriptEpisodes(text).map(part => part.name), theirs.map(part => part.title), name);
  }
  assert.equal(fenjingSplit(edges['无集标记'])[0].title, '第 1 集');
  assert.equal(fenjingSplit(edges['全角数字与两']).length, 1);
  assert.deepEqual(fenjingSplit(edges['场次写在集标题前且标题后没有场号']).map(part => part.title), ['第1集', '第二集']);
  assert.equal(fenjingSplit(edges['序章没有集标记'])[0].title, '第 1 集');
});

test('txt、fountain、fdx、docx 读出来和分镜站一样，再分集也一样', async () => {
  const files = [
    ['two-episodes.txt', 'two-episodes.txt'],
    ['two-episodes.fountain', 'two-episodes.fountain'],
    ['two-episodes.fdx', 'two-episodes.fdx'],
    ['two-episodes.docx', 'two-episodes.docx'],
  ];
  for (const [file, name] of files) {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/scripts/' + file, import.meta.url)));
    const theirs = (await fenjingBytes(bytes, name)).replace(/\r\n/g, '\n').trim();
    const ours = await readScript({name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
    assert.equal(ours.replace(/\r\n/g, '\n').trim(), theirs, name);
    assert.deepEqual(splitEpisodes(ours).map(part => part.title), fenjingSplit(theirs).map(part => part.title), name);
  }
  assert.equal(wordXmlToText(docxXml('第一集\n1-1 日 内 门房')).includes('第一集'), true);
});

test('同一份模型 JSON 经两边清洗后，人物场景道具字段一致，小传外貌留在人物上', () => {
  const episode = splitEpisodes(script)[0].script;
  const mock = {
    title: '夜渡 第一集',
    logline: '一把钥匙。',
    style_lock: '夜、湿、霓虹',
    characters: [
      {name: '凯恩和林夏', appearance: '不该留下'},
      {name: '路人', appearance: '不该留下'},
      {name: '凯恩', role: '渡船水手', age: '28', gender: '男', appearance: '短发，左颊有旧疤，眼神沉', costume: '黑色粗呢短外套，灰衬衫', script_refs: [{excerpt: '凯恩：船还没来。'}]},
      {name: '林夏', role: '报馆记者', age: '26岁', gender: '女', appearance: '齐耳黑发，戴细金丝眼镜', costume: '米色风衣，白衬衫'},
      {name: '老周', role: '候船室售票员', appearance: '花白短发，金丝眼镜', costume: '深蓝制服'},
    ],
    locations: [
      {name: '1-1 黄浦江边', heading: '1-1 夜 外 黄浦江边', description: '锈蚀栏杆，对岸霓虹', time_of_day: '夜', weather: '细雨', atmosphere: '冷'},
      {name: '1-2 候船室', heading: '1-2 夜 内 老轮渡候船室', description: '日光灯坏了一半，柜台', time_of_day: '夜'},
    ],
    props: [
      {name: '缺角铜钥匙', category: '道具', description: '缺了一角', material: '黄铜', significance: '它开的不是门', used_by: '凯恩'},
      {name: '旧怀表', category: '道具', description: '还在走', material: '黄铜', used_by: '老周'},
    ],
  };
  const input = {title: '夜渡 第一集', script: episode};
  assert.deepEqual(normalizeParseAssets(mock, input), fenjingNormalize(mock, input));
  const normalized = normalizeParseAssets(JSON.stringify(mock), input);
  assert.deepEqual(normalized.characters.map(item => item.name), ['凯恩', '林夏', '老周']);
  assert.equal(normalized.characters[0].appearance, '短发，左颊有旧疤，眼神沉');
  assert.match(normalized.characters[0].costume, /黑色粗呢短外套/);
  assert.equal(normalized.characters[0].script_refs[0].excerpt, '凯恩：船还没来。');
  assert.equal(normalized.locations.length, 2);
  assert.equal(normalized.props.length, 2);
  const prompt = parseAssetsPrompt({title: '夜渡', script: episode, bible: characterBibleBlock(script), visualStyle: 'cinematic'});
  assert.match(prompt.system, /对照人物小传补外貌和服装/);
  assert.match(prompt.system, /禁止把两个角色写进同一条/);
  assert.match(prompt.system, /写实电影/);
  assert.match(prompt.user, /人物小传/);
  assert.match(prompt.user, /凯恩/);
  const local = breakScript(script);
  assert.deepEqual(local.characters.map(item => item.name), ['凯恩', '林夏', '老周']);
  assert.equal(local.characters.find(item => item.name === '凯恩').appearance, '短发，左颊有旧疤，眼神沉');
  assert.match(local.characters.find(item => item.name === '林夏').costume, /米色风衣/);
  assert.ok(local.locations.length >= 2);
  assert.ok(local.props.some(item => item.name.includes('铜钥匙')));
  assert.ok(local.beats.length >= 3);
});

test('正片拆解名单：两集、三个人物外貌来自小传', () => {
  const parts = splitEpisodes(script);
  assert.deepEqual(parts.map(part => part.title), ['第一集', '第二集']);
  const first = breakScript(`${characterBibleBlock(script)}\n${parts[0].script}`);
  const second = breakScript(`${characterBibleBlock(script)}\n${parts[1].script}`);
  assert.deepEqual(first.characters.filter(item => item.appearance).map(item => item.name), ['凯恩', '林夏', '老周']);
  assert.deepEqual(second.characters.filter(item => item.appearance).map(item => item.name), ['林夏']);
  assert.ok(first.beats.length >= 2);
  assert.equal(second.beats.length >= 1, true);
});
