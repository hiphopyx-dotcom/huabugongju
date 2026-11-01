import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Pages from '../pages/video-templates.mjs';
import * as Studio from '../public/studio/video-templates.mjs';
import {project} from '../public/studio/core.mjs';
import {bindSkillsForTest, mergeSkillPrompt, projectSkillText, shotSkillControl, skillAdminEntry, skillLibraryMarkup, skillsActive} from '../pages/skill-panel.mjs';

test('总开关关闭时，六类视频模板输出与正式站逐字一致，技能界面不出现', () => {
  bindSkillsForTest(false, [{id: 's', name: '外来技能', body: '不要出现', enabled: true, stages: 'video'}]);
  assert.equal(skillsActive(), false);
  assert.equal(skillLibraryMarkup({settings: {videoSkillId: 'builtin:fight'}}, true), '');
  assert.equal(shotSkillControl({id: 'shot-1', skillId: 'builtin:fight'}, 0), '');
  assert.equal(skillAdminEntry(), '');
  assert.equal(projectSkillText({settings: {videoSkillId: 'builtin:fight', videoDuration: 10}}), '');
  const parts = ['原始创作内容', '', '镜头语言'];
  assert.equal(mergeSkillPrompt(parts, '技能正文', false), parts.filter(Boolean).join('\n\n'));
  assert.deepEqual(Pages.templates.map(item => item.id), Studio.templates.map(item => item.id));
  assert.equal(Pages.templatesFor(false), Pages.templates);
  const sample = project();
  Object.assign(sample.settings, {videoTemplateBrand: '剧爆棚', videoTemplateSubject: '影视创作工作台', videoTemplateAudience: '编剧', videoTemplateSellingPoints: '多图参考', videoTemplateCTA: '预约演示', videoDuration: 15, videoRatio: '9:16', videoRefs: ['asset-1'], videoSkillId: 'builtin:fight', videoSequence: true});
  sample.assets = [{id: 'asset-1', name: '产品界面.png', kind: 'image', description: '真实页面'}];
  for (const template of Studio.templates) {
    sample.settings.videoTemplateId = template.id;
    assert.equal(Pages.build(sample).prompt, Studio.build(sample).prompt);
  }
  const migration = fs.readFileSync(new URL('../deploy/migrations/20261101_skills.sql', import.meta.url), 'utf8');
  const doc = fs.readFileSync(new URL('../docs/skills-rollout.md', import.meta.url), 'utf8');
  assert.equal(/\b(DROP|ALTER|UPDATE|DELETE|INSERT|TRUNCATE)\b/i.test(migration), false);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS studio_skills/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS studio_skill_uses/);
  assert.ok(doc.includes(migration.trim()));
  const studioApp = fs.readFileSync(new URL('../public/studio/app.mjs', import.meta.url), 'utf8');
  assert.equal(studioApp.includes('skillLibraryMarkup'), false);
  assert.equal(studioApp.includes('技能库'), false);
});

test('开关打开后才会拼入技能，并且每段技能单独截到 1500 字', () => {
  bindSkillsForTest(true, []);
  const library = skillLibraryMarkup({settings: {}}, false);
  assert.match(library, /技能库/);
  assert.equal(library.includes('data-act="skill-import"'), false);
  assert.match(skillLibraryMarkup({settings: {}}, true), /导入技能/);
  assert.match(shotSkillControl({id: 'shot-1', skillId: ''}, 0), /镜头1技能/);
  assert.match(skillAdminEntry(), /技能总览/);
  const long = '招'.repeat(1800);
  bindSkillsForTest(true, [{id: 'skill-1', name: '长技能', body: long, enabled: true, stages: 'video'}]);
  const project = {id: 'p', settings: {videoSequence: true, videoShots: [{id: 'a', skillId: 'skill-1', duration: 8}, {id: 'b', skillId: '', duration: 8}]}};
  const text = projectSkillText(project);
  assert.ok(Array.from(text).length <= 1500);
  assert.match(text, /已截断/);
  const merged = mergeSkillPrompt(['原提示'], text, true);
  assert.ok(merged.startsWith('原提示'));
  assert.equal(mergeSkillPrompt([merged], text, true), merged);
  bindSkillsForTest(false);
});
