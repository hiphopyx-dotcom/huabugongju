import {test} from 'node:test';
import assert from 'node:assert/strict';
import {grokRatio, GROK_RATIOS, PROMPT_BOX, IMAGE_MODE, SUBMIT, STEPS, MemberStop} from './executor.mjs';
import {processJob} from './worker.mjs';

test('workbench ratios map onto the five ratios grok.com/imagine offers', () => {
  for (const r of GROK_RATIOS) assert.equal(grokRatio(r), r);
  assert.equal(grokRatio('3:4'), '2:3');
  assert.equal(grokRatio('4:3'), '3:2');
  assert.equal(grokRatio(''), '');
});
test('the logged-in page controls match: prompt box, 图片 not 视频 or 代理, 提交', () => {
  assert.match('向 Grok 提任何问题', PROMPT_BOX);
  assert.match('图片', IMAGE_MODE);
  for (const other of ['视频', '代理', '自动模式', '图像数量']) assert.doesNotMatch(other, IMAGE_MODE);
  assert.match('提交', SUBMIT);
  assert.doesNotMatch('自动模式', SUBMIT);
});
test('steps are fixed and a failure records the step it stopped at', async () => {
  assert.deepEqual(STEPS, ['打开页面', '切图片', '选宽高比', '找输入框', '输入', '提交', '等图', '下载']);
  const lines = [];
  const {result, stats} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '3:4'}, {
    open: async () => ({close: async () => {}}), log: l => lines.push(l),
    imagine: async () => {const e = new MemberStop('PAGE'); e.step = '选宽高比'; throw e;},
  });
  assert.deepEqual(result, {error: 'REJECTED', reason: 'PAGE'});
  assert.equal(stats.step, '选宽高比');
  assert.ok(lines.some(l => l.includes('卡在步骤：选宽高比')), lines.join('\n'));
});

import {submitWithRecheck} from './executor.mjs';
const fake = (over = {}) => {const lines = [], clicks = []; return {lines, clicks, args: {find: async () => ({}), enabled: async () => true, hasText: async () => true, click: async b => clicks.push(b), responded: async () => true, settle: async () => {}, log: l => lines.push(l), ...over}};};
test('submit: a missing or disabled button is rechecked once after the page settles, then clicked once', async () => {
  let n = 0; const f = fake({find: async () => (n++ ? {} : null)});
  assert.equal(await submitWithRecheck(f.args), 2);
  assert.equal(f.clicks.length, 1);
  assert.ok(f.lines[0].includes('没找到提交按钮'));
  let m = 0; const g = fake({enabled: async () => m++ > 0});
  assert.equal(await submitWithRecheck(g.args), 2); assert.equal(g.clicks.length, 1);
});
test('submit: still not ready after the recheck is a definite SUBMIT failure naming the stall', async () => {
  const f = fake({enabled: async () => false});
  await assert.rejects(submitWithRecheck(f.args), e => e.reason === 'SUBMIT' && e.definite && e.detail === '提交按钮不可点');
  assert.equal(f.clicks.length, 0);
  const g = fake({hasText: async () => false});
  await assert.rejects(submitWithRecheck(g.args), e => e.detail === '输入框没有内容');
});
test('submit: a click with no response is never repeated and stays uncertain', async () => {
  const f = fake({responded: async () => false});
  await assert.rejects(submitWithRecheck(f.args), e => e.reason === 'SUBMIT' && !e.definite && e.detail === '点了提交无响应');
  assert.equal(f.clicks.length, 1);
});
test('a browser that never opened is a definite failure (refunded), not uncertain', async () => {
  const {result, stats} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '1:1'}, {open: async () => {throw new Error('launch failed');}, log: () => {}});
  assert.deepEqual(result, {error: 'REJECTED', reason: 'PAGE'});
  assert.equal(stats.step, '启动');
});
