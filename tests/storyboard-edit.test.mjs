import test from 'node:test';
import assert from 'node:assert/strict';
import {insertBeatAfter, insertSceneAfter, moveSceneBlock, moveBeat, dragEnabled, ORDER_UNSAVED, sceneCode} from '../public/studio/storyboard-edit.mjs';
import {parseFrameAspect, setEpisodeAspect, episodeAspectOf, DEFAULT_FRAME_ASPECT} from '../public/studio/frame-aspect.mjs';
import {ensureDesk, prepareStill} from '../public/studio/pianchang-core.mjs';
import {shotData} from '../public/studio/storyboard.mjs';
import {project} from '../public/studio/core.mjs';

const beat = (id, heading, extra = {}) => ({
  id, episode: '第一集', scene_heading: heading, action: '动作'+id, dialogue: '台词'+id,
  shot_size: '特写', composition: '仰拍', framing: '三分构图', camera_move: '推',
  stylize: '黑色电影', lighting: '伦勃朗光', technique: '', ots_from: 'a', ots_to: 'b',
  duration_sec: 6, next_gap_sec: 0.5, start_sec: 0, ...extra,
});

test('第 3 镜后加一镜会复制镜头字段并顺延序号', () => {
  const beats = [beat('1','1-1'), beat('2','1-1'), beat('3','1-2'), beat('4','1-2')];
  const next = insertBeatAfter(beats, '3', () => 'new');
  assert.deepEqual(next.map(item => item.id), ['1','2','3','new','4']);
  assert.equal(next[3].seq, 4);
  assert.equal(next[4].seq, 5);
  for (const key of ['scene_heading','action','dialogue','shot_size','composition','framing','camera_move','stylize','lighting','technique','ots_from','ots_to']) {
    assert.equal(next[3][key], beats[2][key]);
  }
  assert.equal(next[3].duration_sec, 4);
  assert.equal(next[3].next_gap_sec, 0.5);
});

test('把第 2 场拖到第 1 场前，场内镜头跟着走', () => {
  const beats = [beat('a','1-1'), beat('b','2-1'), beat('c','2-1',{episode:'第二集'})];
  const next = moveSceneBlock(beats, '第一集', '2-1', '1-1');
  assert.deepEqual(next.filter(item => item.episode === '第一集').map(item => item.id), ['b','a']);
  assert.equal(next.find(item => item.id === 'c').episode, '第二集');
  assert.throws(() => moveSceneBlock(beats, '第一集', '9-9', '1-1'), new RegExp(ORDER_UNSAVED));
});

test('查找时不能拖动', () => {
  assert.equal(dragEnabled(''), true);
  assert.equal(dragEnabled('  凯恩'), false);
  assert.equal(sceneCode('12-3 夜 内 门房'), '12-3');
});

test('这场后面加一场会插在该场最后一镜之后', () => {
  const beats = [beat('a','1-1'), beat('b','2-1')];
  const next = insertSceneAfter(beats, '第一集', '1-1', () => 'scene');
  assert.deepEqual(next.map(item => item.id), ['a','scene','b']);
  assert.equal(next[1].scene_heading, '新场');
  assert.equal(next[1].duration_sec, 4);
});

test('镜头可以在本集内拖到另一镜的位置', () => {
  const beats = [beat('1','1-1'), beat('2','1-1'), beat('3','1-1')];
  const next = moveBeat(beats, '第一集', '3', '1');
  assert.deepEqual(next.map(item => item.id), ['3','1','2']);
});

test('画幅按集保存，默认 16:9', () => {
  const desk = {episode: '第一集', aspect: '16:9', episodeAspects: {}};
  assert.equal(episodeAspectOf(desk), DEFAULT_FRAME_ASPECT);
  setEpisodeAspect(desk, '第一集', '9 / 16');
  desk.episode = '第二集';
  assert.equal(episodeAspectOf(desk), '16:9');
  desk.episode = '第一集';
  assert.equal(episodeAspectOf(desk), '9:16');
  assert.throws(() => parseFrameAspect('2:1'));
});

test('七个镜头语言字段进入出图和出视频提示词', () => {
  const p = project('夜渡');
  p.script = '第一集\n1-1 夜 内 门房\n△凯恩推门。';
  const desk = ensureDesk(p, () => 'id');
  desk.episode = '第一集';
  desk.beats = [beat('shot', '1-1 夜 内 门房')];
  p.shots = [{id:'shot', episode:'第一集', scene:'1-1 夜 内 门房', description:'凯恩推门', dialogue:'', duration:4, size:'特写', angle:'仰拍', framing:'三分构图', camera:'推', stylize:'黑色电影', lighting:'伦勃朗光', technique:'', characterNames:[], locationNames:[], propNames:[]}];
  const still = prepareStill(p, desk, 'storyboard', 'shot', 'frame');
  for (const word of ['特写','三分构图','仰拍','推','黑色电影','伦勃朗光']) assert.match(still.prompt, new RegExp(word));
  const video = shotData(p, p.shots[0]).prompt;
  for (const word of ['特写','三分构图','仰拍','推','黑色电影','伦勃朗光']) assert.match(video, new RegExp(word));
});
