import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/studio/core.mjs';
import * as DR from '../public/studio/directing-recipes.mjs';

test('七类导演配方可按意图生成提示词，并兼容旧工程与逐镜优先', () => {
  const p = C.project();
  Object.assign(p.settings, {
    directingIntention: '寿宴敬茶翻盘',
    directingSubject: '三十多岁女性，短发，深色旗袍',
    directingAction: '她把茶杯放到老人面前',
    directingNotes: '固定镜头，无配乐',
    videoDuration: 15,
    videoRatio: '9:16',
    videoRefs: ['asset-1'],
  });
  p.assets = [{id: 'asset-1', name: '旗袍参考.png', kind: 'image', description: '锁服装'}];
  assert.equal(DR.recipes.length, 7);
  for (const recipe of DR.recipes) {
    p.settings.directingRecipeId = recipe.id;
    const d = DR.build(p);
    assert.equal(d.id, recipe.id);
    assert.match(d.prompt, /导演配方/);
    assert.match(d.prompt, /寿宴敬茶翻盘/);
    assert.match(d.prompt, /深色旗袍/);
    assert.match(d.prompt, /茶杯/);
    assert.match(d.prompt, /固定镜头/);
    assert.match(d.prompt, /旗袍参考\.png/);
    assert.match(d.prompt, /9:16/);
    assert.ok(!d.prompt.includes('undefined'));
    assert.ok(d.rules.length >= 3);
  }
  const before = structuredClone(p);
  DR.build(p);
  assert.deepEqual(p, before);
  p.settings.directingRecipeId = 'unknown';
  assert.equal(DR.build(p).id, 'shot');
  p.settings.videoSequence = true;
  assert.match(DR.build(p).prompt, /逐镜编排.*优先/);
});
