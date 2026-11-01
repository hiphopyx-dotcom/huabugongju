import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_FIGHT_ID, CAMERA_MOVES, CAMERA_POSITIONS, PROHIBITIONS, PROHIBITION_ITEMS, buildFightPrompt, planSegments} from '../pages/fight-template.mjs';

const ORDER = ['【参考权限】', '【人物与武器锁定】', '【场景与机位】', '【分段时间轴】', '【段尾交接】', '【禁止项】'];

test('打戏提示词按固定顺序拼出，禁止项不能拿掉', () => {
  assert.equal(CAMERA_POSITIONS.length, 25);
  assert.equal(CAMERA_MOVES.length, 13);
  const built = buildFightPrompt({
    duration: 10,
    scene: '夜里的警局接待室',
    characters: '凯恩和刺客',
    weapons: '凯恩右手持军刀，刀已出鞘，左手空着；刺客双手各持一把短匕',
    cameraWhere: '东墙边',
    cameraHeight: '齐腰高',
    cameraFacing: '正侧面',
    cameraAim: '两人的胸口',
    moveLabel: '跟着凯恩横向平移，只有他冲上去的时候才跟',
    impacts: '3.2',
    endPose: '凯恩面向西、刀尖朝下',
    references: [{note: '凯恩和刺客的脸、服装、武器'}],
    action: '0–3 秒：凯恩重心压低，往后撤半步蓄力（起势），往前跨一步斜劈（出招）。3.2 秒冲击帧：军刀砍在刺客的左匕上，画面停一下，镜头不动。3.2–6 秒：刺客被震得往后退两步（反应）。6–10 秒：两人分开，凯恩回到低位持刀（收势）。',
    prohibitions: '',
  });
  let at = -1;
  for (const heading of ORDER) {
    const next = built.prompt.indexOf(heading);
    assert.ok(next > at, heading);
    at = next;
  }
  assert.equal(built.id, BUILTIN_FIGHT_ID);
  assert.match(built.prompt, /参考图 1 是凯恩和刺客的脸、服装、武器的唯一依据/);
  assert.match(built.prompt, /凯恩右手持军刀，刀已出鞘，左手空着/);
  assert.match(built.prompt, /机位在东墙边，齐腰高，正侧面拍，对着两人的胸口/);
  assert.match(built.prompt, /主运镜：跟着凯恩横向平移/);
  assert.match(built.prompt, /3\.2 秒冲击帧/);
  assert.match(built.prompt, /画面停一下，镜头不动/);
  assert.match(built.prompt, /起势/);
  assert.match(built.prompt, /出招/);
  assert.match(built.prompt, /反应/);
  assert.match(built.prompt, /收势/);
  assert.match(built.prompt, /下一镜从这个姿势接/);
  assert.ok(built.prompt.endsWith(PROHIBITIONS));
  for (const item of PROHIBITION_ITEMS) assert.ok(built.prompt.includes(item));
  assert.doesNotMatch(built.prompt, /\d+\s*度/);
});

test('分段落在 8–15 秒，动作迁移不超过 9 秒，短段会提醒', () => {
  const thirty = planSegments(30);
  assert.deepEqual(thirty.map(item => item.local), [15, 15]);
  assert.equal(thirty.every(item => item.local >= 8 && item.local <= 15), true);
  const transfer = planSegments(20, {motionTransfer: true});
  assert.equal(transfer.every(item => item.local <= 9), true);
  assert.equal(planSegments(10)[0].short, false);
  const short = buildFightPrompt({duration: 6, characters: '甲', weapons: '甲右手持棍'});
  assert.match(short.prompt, /不到 8 秒/);
  assert.match(short.prompt, /接触/);
  assert.equal(short.segments.length, 1);
  const multi = buildFightPrompt({duration: 30, endPose: '刀尖朝下'});
  assert.equal(multi.segments.length, 2);
  assert.match(multi.prompt, /下一段从这个姿势接/);
  assert.match(multi.prompt, /下一镜从这个姿势接/);
});
