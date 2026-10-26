import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkshopImport, inspectScript, WORKSHOP_IMPORT_LIMITS} from '../public/studio/story-workshop-core.mjs';

function bundle() {
  return {
    project: {
      id: 'old-project', ownerId: 'another-account', title: '  原作品《保留标题》  ',
      logline: '一句话原稿。', genre: '悬疑', episodeCount: 40, premise: '梗概\r\n保留换行。',
      tone: '冷峻', protagonistSeed: '身份待证的守夜人', emotionWant: '找回妹妹',
      outline: {
        logline_refined: '精炼原文', story: '故事细纲原文\n第二段。', loglineLocked: true,
        acts: [{name: '第一幕', pct: 25, range: '1-10', core: '发现信物。', exit: '误认来信人。', locked: true, secret: 'do not adopt'}],
        loops: [{eps: [1, 2, 3], arc: '调查循环。'}],
        foreshadows: [{plant: '铜铃。', payoff_ep: 12}],
        tier2: ['支线甲'], tier3: ['支线乙'], tier4: '终局。',
        episode_plan: [{number: 1, title: '无人来信', act: '第一幕', exit: '不安', hook: '门外响铃。', open: '拆信', synopsis: '原集纲。', locked: true}],
        provider: 'private-route',
      },
      status: 'draft', token: 'never-copy', account: 'old@example.test',
    },
    characters: [{
      id: 'old-character', projectId: 'old-project', userId: 'another-account', name: '陈默', roleType: 'lead',
      identity: '守夜人', appearance: '左眉有疤', catchphrase: '等等。', voice: ['短句', '低声'],
      arc: [{stage: '开场', style: '回避', line: '我不知道。', ownerId: 'hidden'}], costVisual: '常服',
      anchors: ['铜铃'], notes: '小传原文\n不删改。', sortOrder: 2, locked: true, credentials: 'hidden',
    }],
    episodes: [
      {id: 'old-10', projectId: 'old-project', number: 10, title: '第十个夜晚', content: '\r\n△他留下信。\r\n陈默：等等。\r\n', emotionExit: '惊疑', reversals: [{slot: 1, at: '末尾', text: '信上没有字。'}], status: 'draft', qa: {red: 1, amber: 2}, token: 'hidden'},
      {id: 'old-2', number: 2, title: '第二封信', content: '第2集 第二封信\r\n2-1 夜 内 门房\r\n△门没有锁。\r\n'},
    ],
    ownerId: 'another-account', apiKey: 'never-copy', generationJobs: [{prompt: 'private'}],
  };
}

test('imports real ProjectBundle in numeric order and keeps exact titles and bodies', () => {
  const source = bundle(), original = structuredClone(source);
  const result = normalizeWorkshopImport(JSON.stringify(source));
  assert.deepEqual(source, original);
  assert.equal(result.title, source.project.title);
  assert.equal(result.story.targetEpisodes, 40);
  assert.deepEqual(result.settings, {genre: '悬疑', words: '', writing: ''});
  assert.equal(result.script, source.episodes[1].content + '\n\n第10集 第十个夜晚\n' + source.episodes[0].content);
  assert.deepEqual(result.story.importedBundle.episodes.map(item => item.number), [2, 10]);
  assert.equal(result.story.importedBundle.episodes[1].title, '第十个夜晚');
  assert.equal(result.story.importedBundle.episodes[1].content, source.episodes[0].content);
  assert.equal(result.story.premise, source.project.premise);
  assert.match(result.story.outline, /故事细纲原文\n第二段。/);
  assert.match(result.story.outline, /发现信物。/);
  assert.match(result.story.outline, /铜铃。/);
  assert.match(result.story.characters, /小传原文\n不删改。/);
  assert.match(result.story.characters, /我不知道。/);
  assert.match(result.story.episodePlan, /门外响铃。/);
  assert.deepEqual(result.story.importedBundle.project.outline.episode_plan, source.project.outline.episode_plan);
  assert.deepEqual(result.story.importedBundle.episodes[1].reversals, source.episodes[0].reversals);
});

test('imports only public writing fields and does not adopt account or provider metadata', () => {
  const result = normalizeWorkshopImport(bundle());
  const serialized = JSON.stringify(result);
  for (const fragment of ['old-project', 'old-character', 'another-account', 'private-route', 'never-copy', 'hidden', 'old@example.test']) {
    assert.equal(serialized.includes(fragment), false, fragment);
  }
  assert.equal(hasDeepKey(result, ['id', 'projectId', 'userId', 'ownerId', 'token', 'secret', 'credentials', 'account', 'provider', 'apiKey', 'generationJobs']), false);
  assert.equal(result.story.importedBundle.characters[0].locked, true);
  assert.equal(result.story.importedBundle.project.outline.acts[0].locked, true);
});

function hasDeepKey(value, forbidden) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => forbidden.includes(key) || hasDeepKey(item, forbidden));
}

test('supports the workshop database field aliases without treating lexical order as episode order', () => {
  const result = normalizeWorkshopImport({
    project: {title: '数据库作品', episode_count: 12, protagonist_seed: '阿青', emotion_want: '归家', outline_json: JSON.stringify({story: '细纲', episode_plan: []})},
    characters: [{name: '阿青', role_type: 'lead', cost_visual: '常服', sort_order: 1, voice_json: '["慢语"]', anchors_json: '["蓝伞"]', arc_json: '[{"stage":"尾声","style":"坚定","line":"回家。"}]'}],
    episodes: [{ep_number: '10', title: '十', content: '△十。', emotion_exit: '期待', reversals_json: '[]', qa_json: '{"red":0,"amber":0}'}, {ep_number: '2', title: '二', content: '△二。'}],
  });
  assert.equal(result.story.targetEpisodes, 12);
  assert.equal(result.story.protagonistSeed, '阿青');
  assert.equal(result.story.emotionWant, '归家');
  assert.deepEqual(result.story.importedBundle.characters[0].voice, ['慢语']);
  assert.match(result.story.characters, /回家。/);
  assert.ok(result.script.indexOf('第2集') < result.script.indexOf('第10集'));
});

test('keeps existing episode headings and conflicting row metadata intact for review', () => {
  const result = normalizeWorkshopImport({project: {title: '标题'}, characters: [], episodes: [
    {number: 3, title: '数据库原标题', content: '\n第一集 正文中的原标题\n△原文。\n'},
    {number: 9, title: '未写的第九集', content: '\n\n'},
  ]});
  assert.equal(result.script, '\n第一集 正文中的原标题\n△原文。\n');
  assert.equal(result.story.importedBundle.episodes[0].title, '数据库原标题');
  assert.equal(result.story.importedBundle.episodes[1].content, '\n\n');
});

test('canvas v2 writing projection preserves current editable fields and sanitized bundle on round trip', () => {
  const imported = normalizeWorkshopImport(bundle());
  const canvas = {
    version: 2, id: 'old-current-id', ownerId: 'old-owner', title: '当前编辑标题',
    script: '第1集\r\n1-1 日 内 门房\r\n△当前正文。\r\n',
    settings: {genre: '家庭', words: '700–1000字', writing: '保留人物口吻。', provider: 'private'},
    story: {...imported.story, premise: '已修改梗概', outline: '已修改细纲', characters: '已修改小传', episodePlan: '已修改规划', targetEpisodes: 60, ownerId: 'private'},
    assets: [{src: 'data:image/png;base64,unused'}], languageModelJobs: [{account: 'private'}],
  };
  const result = normalizeWorkshopImport(canvas);
  assert.equal(result.title, canvas.title);
  assert.equal(result.script, canvas.script);
  assert.deepEqual(result.settings, {genre: '家庭', words: '700–1000字', writing: '保留人物口吻。'});
  for (const key of ['premise', 'outline', 'characters', 'episodePlan', 'targetEpisodes']) assert.equal(result.story[key], canvas.story[key]);
  assert.deepEqual(result.story.importedBundle, imported.story.importedBundle);
  assert.equal(result.assets, undefined);
  assert.equal(result.languageModelJobs, undefined);
  assert.equal(result.id, undefined);
});

test('allows planning-only works but rejects empty and unsupported formats', () => {
  const result = normalizeWorkshopImport({project: {title: '构思稿', premise: '有人在替她重写记忆。'}, characters: [], episodes: []});
  assert.equal(result.script, '');
  assert.equal(result.story.premise, '有人在替她重写记忆。');
  assert.throws(() => normalizeWorkshopImport({project: {title: '空作品'}, characters: [], episodes: []}), /没有剧本或创作资料/);
  assert.throws(() => normalizeWorkshopImport({project: {title: '不完整'}, episodes: []}), /暂不支持/);
  assert.throws(() => normalizeWorkshopImport({script: '正文', title: '未知格式'}), /暂不支持/);
  assert.throws(() => normalizeWorkshopImport('不是JSON'), /无法读取JSON/);
  assert.throws(() => normalizeWorkshopImport('null'), /格式不正确/);
  assert.throws(() => normalizeWorkshopImport({version: 2, title: ' ', script: '正文'}), /标题为空/);
});

test('rejects ambiguous or oversized inputs rather than silently merging or truncating them', () => {
  assert.throws(() => normalizeWorkshopImport({project: {title: '重复'}, characters: [], episodes: [
    {number: 1, content: '甲'}, {ep_number: 1, content: '乙'},
  ]}), /编号重复/);
  assert.throws(() => normalizeWorkshopImport({project: {title: '无编号'}, characters: [], episodes: [{content: '正文'}]}), /必须有1以上/);
  assert.throws(() => normalizeWorkshopImport({project: {title: '错误'}, characters: [], episodes: [{number: 1, content: {text: '不要吞掉'}}]}), /正文必须是文字/);
  assert.throws(() => normalizeWorkshopImport({project: {title: '其它格式', premise: '有梗概'}, characters: [], episodes: [{number: 1, script: '不能静默丢弃的正文'}]}), /核对content字段/);
  assert.throws(() => normalizeWorkshopImport({project: {title: '错误', outline_json: '{'}, characters: [], episodes: []}), /不是有效的JSON/);
  assert.throws(() => normalizeWorkshopImport({version: 2, title: '长稿', script: '字'.repeat(WORKSHOP_IMPORT_LIMITS.script + 1)}), /原文没有被截断/);
  assert.throws(() => normalizeWorkshopImport({version: 2, title: '标题'.repeat(WORKSHOP_IMPORT_LIMITS.title), script: '正文'}), /作品标题超过/);
  assert.throws(() => normalizeWorkshopImport({version: 2, title: '过大备份', script: '正文', unrelated: 'a'.repeat(WORKSHOP_IMPORT_LIMITS.bytes)}), /JSON超过16MiB/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => normalizeWorkshopImport(cyclic), /不是可读取的JSON/);
});

test('local inspection reports exact empty action, dialogue, scene and episode locations without changing input', () => {
  const script = '第1集\r\n1-1\r\n△\r\n陈默：\r\n第2集\r\n';
  const before = script;
  const issues = inspectScript(script);
  assert.equal(script, before);
  assert.ok(issues.some(item => item.line === 2 && /场头只有/.test(item.message)));
  assert.ok(issues.some(item => item.line === 3 && /动作标记后/.test(item.message)));
  assert.ok(issues.some(item => item.line === 4 && /没有对白/.test(item.message)));
  assert.ok(issues.some(item => item.line === 5 && /未见正文/.test(item.message)));
  assert.ok(issues.every(item => ['warning', 'info'].includes(item.level) && Number.isInteger(item.line)));
});

test('local inspection recognizes Chinese episode headings, conventional scene headings and dialogue', () => {
  const script = '第一集 来信\n1-1 日 内 门房\n人物：陈默\n△陈默拆信。\n陈默（低声）：又是空白。\n第二集\nEXT. 门房 - NIGHT\n△门开了。';
  assert.deepEqual(inspectScript(script), [{level: 'info', line: 1, message: '已识别集标题、场头及动作或对白格式；本地检查不评价剧情质量。'}]);
  const repeated = inspectScript('第十集\n△正文。\n第2集\n△正文。\n第二集\n△正文。');
  assert.ok(repeated.some(item => item.line === 3 && /小于上一集/.test(item.message)));
  assert.ok(repeated.some(item => item.line === 5 && /标题重复/.test(item.message)));
});

test('local inspection describes missing syntax as observations without a quality score', () => {
  assert.match(inspectScript('')[0].message, /尚无剧本正文/);
  const issues = inspectScript('正文没有格式\n陈默：别走。');
  assert.ok(issues.some(item => item.line === 1 && /未识别为/.test(item.message)));
  assert.ok(issues.some(item => /未识别到场头/.test(item.message)));
  assert.ok(issues.some(item => /未识别到△动作/.test(item.message)));
  assert.equal(issues.some(item => /[0-9]+分|评分|评级/.test(item.message)), false);
  const headingsOnly = inspectScript('第1集\n1-1 日 内 客厅\n人物：陈默');
  assert.ok(headingsOnly.some(item => /未见正文/.test(item.message)));
  assert.equal(headingsOnly.some(item => /已识别集标题/.test(item.message)), false);
});
