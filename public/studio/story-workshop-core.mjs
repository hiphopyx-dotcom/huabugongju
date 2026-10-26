// Original workshop: src/lib/data/workshop.ts#getProjectBundle returns the
// ProjectBundle in src/lib/craft/types.ts. Database aliases are accepted too.
// This module only imports creative fields; it never adopts an old identity,
// account, generation job, provider route, or media attachment.
export const WORKSHOP_IMPORT_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  script: 2 * 1024 * 1024,
  text: 512 * 1024,
  title: 500,
  episodes: 1000,
  characters: 1000,
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const alias = (value, ...keys) => keys.map(key => value[key]).find(item => item !== undefined);
const bytes = value => new TextEncoder().encode(value).byteLength;

function text(value, label, limit = WORKSHOP_IMPORT_LIMITS.text, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw Error(`${label}必须是文字`);
  if (value.length > limit) throw Error(`${label}超过${limit.toLocaleString('en-US')}字，请分开导入；原文没有被截断`);
  return value;
}

function number(value, label, fallback = 0, max = WORKSHOP_IMPORT_LIMITS.episodes) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw Error(`${label}需为0–${max}的整数`);
  return n;
}

function boolean(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw Error(`${label}需为是或否`);
  return value;
}

function list(value, label, limit = WORKSHOP_IMPORT_LIMITS.episodes) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw Error(`${label}必须是列表`);
  if (value.length > limit) throw Error(`${label}超过${limit}项，请分开导入；内容没有被截断`);
  return value;
}

function record(value, label) {
  if (!object(value)) throw Error(`${label}格式不正确`);
  return value;
}

function jsonField(value, label) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw Error(`${label}不是有效的JSON`); }
}

function pickText(raw, keys, label) {
  const out = {};
  for (const key of keys) if (has(raw, key)) out[key] = text(raw[key], `${label}·${key}`);
  return out;
}

function textList(value, label) {
  return list(value, label).map((item, i) => text(item, `${label}第${i + 1}项`));
}

function outlineData(raw) {
  if (raw === undefined || raw === null) return {};
  record(raw, '细纲');
  const out = pickText(raw, ['logline_refined', 'story', 'tier4'], '细纲');
  if (has(raw, 'loglineLocked')) out.loglineLocked = boolean(raw.loglineLocked, '故事一句话锁定');
  if (has(raw, 'acts')) out.acts = list(raw.acts, '幕结构').map((item, i) => {
    record(item, `第${i + 1}幕`);
    const act = pickText(item, ['name', 'range', 'core', 'exit'], `第${i + 1}幕`);
    if (has(item, 'pct')) {
      if (typeof item.pct !== 'number' || !Number.isFinite(item.pct) || item.pct < 0 || item.pct > 100) throw Error('幕结构百分比需为0–100');
      act.pct = item.pct;
    }
    if (has(item, 'locked')) act.locked = boolean(item.locked, '幕结构锁定');
    return act;
  });
  if (has(raw, 'loops')) out.loops = list(raw.loops, '故事循环').map((item, i) => {
    record(item, `第${i + 1}个循环`);
    return {eps: list(item.eps, '循环集数').map(n => number(n, '循环集数')), arc: text(item.arc, '循环发展')};
  });
  if (has(raw, 'foreshadows')) out.foreshadows = list(raw.foreshadows, '伏笔').map((item, i) => {
    record(item, `第${i + 1}条伏笔`);
    return {plant: text(item.plant, '伏笔内容'), payoff_ep: number(item.payoff_ep, '回收集数')};
  });
  for (const key of ['tier2', 'tier3']) if (has(raw, key)) out[key] = textList(raw[key], key);
  if (has(raw, 'episode_plan')) out.episode_plan = list(raw.episode_plan, '分集规划').map((item, i) => {
    record(item, `第${i + 1}项分集规划`);
    const plan = {number: number(item.number, '分集规划集数')};
    Object.assign(plan, pickText(item, ['title', 'act', 'exit', 'hook', 'open', 'synopsis'], '分集规划'));
    if (has(item, 'locked')) plan.locked = boolean(item.locked, '分集规划锁定');
    return plan;
  });
  return out;
}

function characterData(raw, i) {
  record(raw, `第${i + 1}个人物`);
  const out = pickText(raw, ['name', 'identity', 'appearance', 'catchphrase', 'notes'], `第${i + 1}个人物`);
  for (const [key, old] of [['roleType', 'role_type'], ['costVisual', 'cost_visual']]) {
    const value = alias(raw, key, old);
    if (value !== undefined) out[key] = text(value, `人物·${key}`);
  }
  for (const [key, old] of [['voice', 'voice_json'], ['anchors', 'anchors_json']]) {
    const value = alias(raw, key, old);
    if (value !== undefined) out[key] = textList(jsonField(value, `人物·${key}`), `人物·${key}`);
  }
  const arc = alias(raw, 'arc', 'arc_json');
  if (arc !== undefined) out.arc = list(jsonField(arc, '人物弧线'), '人物弧线').map((item, n) => pickText(record(item, `第${n + 1}项人物弧线`), ['stage', 'style', 'line'], '人物弧线'));
  const order = alias(raw, 'sortOrder', 'sort_order');
  if (order !== undefined) out.sortOrder = number(order, '人物顺序', 0, 100000);
  if (has(raw, 'locked')) out.locked = boolean(raw.locked, '人物设定锁定');
  return out;
}

function episodeData(raw, i) {
  record(raw, `第${i + 1}集记录`);
  const n = number(alias(raw, 'number', 'ep_number'), '分集编号');
  if (n < 1) throw Error('每集必须有1以上的number或ep_number编号');
  if (typeof raw.content !== 'string') throw Error(`第${n}集正文必须是文字，请核对content字段；未丢弃正文`);
  const out = {
    number: n,
    title: text(raw.title, `第${n}集标题`, WORKSHOP_IMPORT_LIMITS.title),
    content: text(raw.content, `第${n}集正文`, WORKSHOP_IMPORT_LIMITS.script),
  };
  const exit = alias(raw, 'emotionExit', 'emotion_exit');
  if (exit !== undefined) out.emotionExit = text(exit, `第${n}集情绪出口`);
  if (has(raw, 'status')) out.status = text(raw.status, `第${n}集状态`, 120);
  const reversals = alias(raw, 'reversals', 'reversals_json');
  if (reversals !== undefined) out.reversals = list(jsonField(reversals, '反转记录'), '反转记录').map(item => {
    record(item, '反转记录');
    return {slot: number(item.slot, '反转序号'), at: text(item.at, '反转位置'), text: text(item.text, '反转内容')};
  });
  const qa = jsonField(alias(raw, 'qa', 'qa_json'), '原有检查记录');
  if (qa !== undefined && qa !== null) {
    record(qa, '原有检查记录');
    out.qa = {red: number(qa.red, '原有检查记录', 0, 100000), amber: number(qa.amber, '原有检查记录', 0, 100000)};
  }
  return out;
}

function bundleData(raw) {
  record(raw, '原工坊作品');
  const project = record(raw.project, '作品信息');
  if (!Array.isArray(raw.episodes) || !Array.isArray(raw.characters)) throw Error('原工坊作品需包含project、episodes和characters');
  const p = {title: text(project.title, '作品标题', WORKSHOP_IMPORT_LIMITS.title)};
  for (const key of ['logline', 'genre', 'premise', 'tone', 'status']) if (has(project, key)) p[key] = text(project[key], `作品·${key}`);
  for (const [key, old] of [['protagonistSeed', 'protagonist_seed'], ['emotionWant', 'emotion_want']]) {
    const value = alias(project, key, old);
    if (value !== undefined) p[key] = text(value, `作品·${key}`);
  }
  const count = alias(project, 'episodeCount', 'episode_count');
  if (count !== undefined) p.episodeCount = number(count, '目标集数');
  p.outline = outlineData(jsonField(alias(project, 'outline', 'outline_json'), '细纲'));
  const episodes = list(raw.episodes, '分集正文').map(episodeData).sort((a, b) => a.number - b.number);
  if (new Set(episodes.map(item => item.number)).size !== episodes.length) throw Error('分集编号重复，请核对后导入；未合并或丢弃任何一集');
  const characters = list(raw.characters, '人物小传', WORKSHOP_IMPORT_LIMITS.characters).map(characterData);
  return {project: p, characters, episodes};
}

const EPISODE = /^第([一二三四五六七八九十百千零〇两\d]+)集(?=\s|$|[：:、.《（(])/;

function assembledScript(episodes) {
  const result = episodes.filter(item => item.content.trim()).map(item => {
    // Do not alter existing headings, even when they disagree with the row's
    // number or title; the preview retains both pieces for the author to review.
    if (EPISODE.test(item.content.trimStart())) return item.content;
    return `第${item.number}集${item.title ? ` ${item.title}` : ''}\n${item.content}`;
  }).join('\n\n');
  return text(result, '合并后的剧本', WORKSHOP_IMPORT_LIMITS.script);
}

const fieldLines = (value, labels) => labels.flatMap(([key, label]) => value[key] !== undefined && value[key] !== '' ? [`${label}：${value[key]}`] : []);

function outlineText(value) {
  const parts = fieldLines(value, [['logline_refined', '故事一句话'], ['story', '故事细纲']]);
  for (const act of value.acts || []) parts.push(fieldLines(act, [['name', '幕'], ['pct', '占比（%）'], ['range', '集数范围'], ['core', '核心事件'], ['exit', '出口']]).join('\n'));
  for (const loop of value.loops || []) parts.push(`故事循环（${loop.eps.join('、')}集）：${loop.arc}`);
  for (const item of value.foreshadows || []) parts.push(`伏笔：${item.plant}\n回收集数：${item.payoff_ep}`);
  for (const [key, label] of [['tier2', '二级线索'], ['tier3', '三级线索']]) if (value[key]?.length) parts.push(`${label}：\n${value[key].join('\n')}`);
  if (value.tier4) parts.push(`四级线索：${value.tier4}`);
  return parts.filter(Boolean).join('\n\n');
}

function charactersText(characters) {
  return characters.map(item => [
    ...fieldLines(item, [['name', '姓名'], ['roleType', '角色类型'], ['identity', '身份'], ['appearance', '外貌'], ['catchphrase', '口头禅'], ['costVisual', '视觉成本'], ['notes', '小传与备注']]),
    item.voice?.length ? `语言特点：\n${item.voice.join('\n')}` : '',
    item.anchors?.length ? `人物锚点：\n${item.anchors.join('\n')}` : '',
    ...(item.arc || []).map(beat => fieldLines(beat, [['stage', '弧线阶段'], ['style', '行为方式'], ['line', '代表台词']]).join('\n')),
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

function planText(plans) {
  return plans.map(item => [`第${item.number}集${item.title ? ` ${item.title}` : ''}`,
    ...fieldLines(item, [['act', '所属幕'], ['synopsis', '梗概'], ['open', '开场'], ['exit', '情绪出口'], ['hook', '结尾钩子']]),
  ].join('\n')).join('\n\n');
}

function storyFromBundle(bundle) {
  const p = bundle.project;
  return {
    premise: p.premise || '',
    logline: p.logline || '',
    tone: p.tone || '',
    protagonistSeed: p.protagonistSeed || '',
    emotionWant: p.emotionWant || '',
    outline: outlineText(p.outline),
    characters: charactersText(bundle.characters),
    episodePlan: planText(p.outline.episode_plan || []),
    targetEpisodes: p.episodeCount || bundle.episodes.at(-1)?.number || 0,
    importedBundle: bundle,
  };
}

function decode(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    if (bytes(raw) > WORKSHOP_IMPORT_LIMITS.bytes) throw Error('JSON超过16MiB，请拆分导入；内容没有被截断');
    try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw Error('无法读取JSON，请选择作品JSON文件'); }
  }
  record(value, '导入内容');
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw Error('导入内容不是可读取的JSON对象'); }
  if (bytes(serialized) > WORKSHOP_IMPORT_LIMITS.bytes) throw Error('JSON超过16MiB，请拆分导入；内容没有被截断');
  return value;
}

/**
 * Accepts original workshop ProjectBundle (or its database field aliases), and
 * the current canvas version:2 project JSON. Canvas media, IDs and jobs are not
 * imported here: this is a new writing project, not an account/project restore.
 * story.importedBundle keeps all known public writing fields without rewriting.
 */
export function normalizeWorkshopImport(raw) {
  const value = decode(raw);
  let result;
  if (object(value.project) && Array.isArray(value.episodes) && Array.isArray(value.characters)) {
    const bundle = bundleData(value);
    result = {title: bundle.project.title, script: assembledScript(bundle.episodes),
      settings: {genre: bundle.project.genre || '', words: '', writing: ''},
      story: storyFromBundle(bundle), source: {format: 'workshop-bundle', episodeCount: bundle.episodes.length}};
  } else if (value.version === 2 && typeof value.script === 'string' && typeof value.title === 'string') {
    const settings = value.settings === undefined ? {} : record(value.settings, '创作设置');
    const story = value.story === undefined ? {} : record(value.story, '创作资料');
    let nextStory = {premise: '', outline: '', characters: '', episodePlan: '', targetEpisodes: 0};
    if (story.importedBundle !== undefined) nextStory = storyFromBundle(bundleData(story.importedBundle));
    for (const key of ['premise', 'logline', 'tone', 'protagonistSeed', 'emotionWant', 'outline', 'characters', 'episodePlan', 'reviewReport']) {
      if (has(story, key)) nextStory[key] = text(story[key], `创作资料·${key}`);
    }
    if (has(story, 'targetEpisodes')) nextStory.targetEpisodes = number(story.targetEpisodes, '目标集数');
    result = {title: text(value.title, '作品标题', WORKSHOP_IMPORT_LIMITS.title),
      script: text(value.script, '剧本', WORKSHOP_IMPORT_LIMITS.script),
      settings: {genre: text(settings.genre, '题材'), words: text(settings.words, '单集字数'), writing: text(settings.writing, '创作要求')},
      story: nextStory, source: {format: 'canvas-v2'}};
  } else throw Error('暂不支持这个JSON；请选择原工坊project/episodes/characters作品数据，或剧爆棚V2项目JSON');
  if (!result.title.trim()) throw Error('作品标题为空，请先补充标题');
  // Formatting many source fields can create a longer editable text field.
  // Check that result too, so a successful import can be read back unchanged.
  for (const key of ['premise', 'logline', 'tone', 'protagonistSeed', 'emotionWant', 'outline', 'characters', 'episodePlan', 'reviewReport']) {
    if (result.story[key] !== undefined) text(result.story[key], `创作资料·${key}`);
  }
  const meaningful = [result.script, ...['premise', 'logline', 'outline', 'characters', 'episodePlan', 'reviewReport'].map(key => result.story[key])];
  if (!meaningful.some(item => item?.trim())) throw Error('作品只有标题，没有剧本或创作资料；未创建空作品');
  return result;
}

const SCENE = /^(?:第[一二三四五六七八九十百千零〇两\d]+场(?:\s|$|[：:、.])|(?:场景|场次)[：:]|\d+\s*[—–－-]\s*\d+(?:\s|$|[：:、.])|(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)(?:\s|$)|(?:内景|外景)(?:\s|$|[：:]))/i;
const META = /^(?:人物|出场人物|角色|字幕|画外音|旁白|音效|音乐|转场|时间|地点|片名|剧名|题材|集数|本集标题)[：:]/;
const DIALOGUE = /^[^：:\n]{1,30}[：:]/;

function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
  const units = {十: 10, 百: 100, 千: 1000};
  let total = 0, digit = 0;
  for (const char of value) {
    if (has(digits, char)) digit = digits[char];
    else { total += (digit || 1) * units[char]; digit = 0; }
  }
  return total + digit;
}

/** Local syntax observations only. The input is never rewritten or scored. */
export function inspectScript(input) {
  const source = text(input, '剧本', WORKSHOP_IMPORT_LIMITS.script);
  if (!source.trim()) return [{level: 'info', line: 1, message: '尚无剧本正文，粘贴或导入后可检查格式。'}];
  const issues = [], lines = source.replace(/\r\n?/g, '\n').split('\n');
  const add = (level, line, message) => issues.push({level, line, message});
  let episodeCount = 0, sceneCount = 0, actionCount = 0, dialogueCount = 0, lastEpisode = null;
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) continue;
    const episode = s.match(EPISODE);
    if (episode) {
      if (lastEpisode && !lastEpisode.body) add('warning', lastEpisode.line, '这集标题后未见正文。');
      const n = chineseNumber(episode[1]);
      if (n < 1) add('warning', i + 1, '集编号为0，请核对是否为序章或编号写错。');
      if (seen.has(n)) add('warning', i + 1, `第${n}集标题重复，请核对分集位置。`);
      else if (lastEpisode && n < lastEpisode.number) add('warning', i + 1, '集编号小于上一集，请核对是否为倒序或粘贴错位。');
      seen.add(n); lastEpisode = {number: n, line: i + 1, body: false}; episodeCount++; continue;
    }
    if (SCENE.test(s)) {
      sceneCount++;
      const body = s.replace(SCENE, '').replace(/^[\s：:、.]+/, '');
      if (!body) add('warning', i + 1, '场头只有场次标记，未填写地点、时间等场景信息。');
      continue;
    }
    if (META.test(s)) continue;
    if (lastEpisode) lastEpisode.body = true;
    if (/^[△▲]/.test(s)) {
      actionCount++;
      if (!s.slice(1).trim()) add('warning', i + 1, '动作标记后没有动作文字。');
      if (s.startsWith('▲')) add('info', i + 1, '这行动作用了▲；当前规范示例使用△，请核对格式。');
      continue;
    }
    if (DIALOGUE.test(s) && !/^(?:https?|data):/i.test(s)) {
      dialogueCount++;
      if (!s.replace(DIALOGUE, '').trim()) add('warning', i + 1, '姓名冒号后没有对白文字。');
      continue;
    }
    add('info', i + 1, '这行未识别为场头、△动作或“姓名：对白”，请核对格式。');
  }
  if (lastEpisode && !lastEpisode.body) add('warning', lastEpisode.line, '这集标题后未见正文。');
  if (!episodeCount) add('info', 1, '未识别到集标题；多集剧本可使用“第1集”单独起行。');
  if (!sceneCount) add('warning', 1, '未识别到场头；可使用“1-1 日 内 客厅”或“INT. 客厅 - DAY”等格式。');
  if (!actionCount && !dialogueCount) add('info', 1, '未识别到△动作或“姓名：对白”正文，请核对是否只粘贴了标题、场头或未标记文本。');
  if (!actionCount && dialogueCount) add('info', 1, '已识别到对白，未识别到△动作行，请核对画面动作是否齐全。');
  if (!issues.length) add('info', 1, '已识别集标题、场头及动作或对白格式；本地检查不评价剧情质量。');
  issues.sort((a, b) => a.line - b.line);
  if (issues.length > 200) return [...issues.slice(0, 200), {level: 'info', line: 1, message: `还有${issues.length - 200}处格式提示未展开；剧本原文完整保留。`}];
  return issues;
}
