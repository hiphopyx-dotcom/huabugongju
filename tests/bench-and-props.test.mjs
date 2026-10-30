import test from 'node:test';
import assert from 'node:assert/strict';
import {apiBase, authToken} from '../public/studio/api-client.mjs';
import {buildImageWorkshopPrompt} from '../public/studio/image-workshop-core.mjs';
import {LOOK_STYLES} from '../public/studio/image-workflow.mjs';

test('没有预览标记时接口基址为空，不读令牌', () => {
  assert.equal(apiBase(), '');
  assert.equal(authToken(), '');
});

test('道具主图会先写材质、磨损、使用者和叙事功能', () => {
  const made = buildImageWorkshopPrompt('props', {kind:'hero', name:'铜钥匙', material:'黄铜，边缘磨损', usedBy:'LIN', extraPrompt:'叙事功能：它开的不是门'});
  assert.match(made.prompt, /先分析材质、磨损、谁在用和叙事功能/);
  assert.match(made.prompt, /黄铜，边缘磨损/);
  assert.match(made.prompt, /LIN/);
  assert.match(made.prompt, /叙事功能/);
});

test('出图风格包含分镜站那几项', () => {
  const labels = LOOK_STYLES.map(style => style.label);
  for (const name of ['写实电影','动漫电影','水墨','油画','霓虹赛博']) assert.ok(labels.includes(name), name);
});
