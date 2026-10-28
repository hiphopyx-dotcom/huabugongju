import {test} from 'node:test';
import assert from 'node:assert/strict';
import {breakScript} from '../public/studio/pianchang-parse.mjs';
import * as B from '../public/studio/script-breakdown.mjs';
import * as C from '../public/studio/core.mjs';

const script = `第一集
1-1 日 内 客厅
人物：小林、小陈
道具：钥匙
△小林拿起钥匙。
小林：我回来了。
1-2 夜 外 院子
小陈：等一下！
△小陈推开门。`;

test('片场拆解分出人物、场景、道具，连续分镜钉原文', () => {
  const parsed = breakScript(script);
  assert.deepEqual(parsed.characters.map(c => c.name), ['小林', '小陈']);
  assert.deepEqual(parsed.locations.map(l => l.name), ['客厅', '院子']);
  assert.equal(parsed.locations[0].heading, '1-1 日 内 客厅');
  assert.equal(parsed.locations[0].description, '小林拿起钥匙。');
  assert.deepEqual(parsed.props.map(p => p.name), ['钥匙']);
  assert.equal(parsed.beats.length, 4);
  assert.equal(parsed.beats[0].shot_type, '全景');
  assert.equal(parsed.beats[0].action, '小林拿起钥匙。');
  assert.equal(parsed.beats[0].script_excerpt, '小林拿起钥匙。');
  assert.equal(parsed.beats[1].shot_type, '过肩镜头');
  assert.equal(parsed.beats[1].dialogue, '小林：我回来了。');
  assert.equal(parsed.beats[2].scene_heading, '1-2 夜 外 院子');
  assert.equal(parsed.beats[2].shot_type, '过肩镜头');
  assert.equal(parsed.beats[3].shot_type, '中景');
  assert.ok(parsed.beats.slice(0, -1).every(b => b.next_gap_sec === 0.5));
  assert.equal(parsed.beats.at(-1).next_gap_sec, 0);
  assert.ok(parsed.beats.every(b => b.duration_sec >= 3 && b.duration_sec <= 15));
  assert.equal(parsed.beats[1].start_sec, parsed.beats[0].duration_sec);
});

test('没有人物行时才从台词收名字，群众称呼丢掉', () => {
  const parsed = breakScript('小林：门开了。\n众人：上！');
  assert.deepEqual(parsed.characters.map(c => c.name), ['小林']);
  assert.equal(parsed.beats[0].shot_type, '过肩镜头');
});

test('小传里的外貌会补进同名人物', () => {
  const full = `人物小传\n小林\n年龄 25岁\n身份 归人\n外貌 短发，左眉有疤\n常穿灰色风衣。\n第一集\n1-1 日 内 客厅\n人物：小林\n△小林进门。`;
  const parsed = breakScript(full);
  assert.equal(parsed.characters[0].appearance, '短发，左眉有疤');
  assert.equal(parsed.characters[0].role, '归人');
  assert.match(parsed.characters[0].costume, /灰色风衣/);
  assert.equal(parsed.beats.length, 1);
  assert.equal(parsed.beats[0].shot_type, '全景');
});

test('写入项目后镜头能通过校验，过肩在机位而不是景别', () => {
  const parsed = breakScript(script);
  const p = C.project();
  p.script = script;
  p.shots = B.bindReferences(B.shotsFromBreak(parsed), []);
  p.breakdown = {...parsed, method: 'pianchang', script};
  assert.equal(p.shots[0].size, '全景');
  assert.equal(p.shots[0].angle, '眼睛平视');
  assert.equal(p.shots[1].size, '中景');
  assert.equal(p.shots[1].angle, '过肩镜头');
  assert.equal(p.shots[1].nextGap, 0.5);
  assert.equal(p.shots[0].sourceText, '小林拿起钥匙。');
  assert.deepEqual(p.shots[0].propNames, ['钥匙']);
  assert.deepEqual(p.shots[0].locationNames, ['客厅']);
  assert.doesNotThrow(() => C.validate(p));
});
