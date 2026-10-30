// 片场剧本拆解的本地规则。和 sunny-terra screenplay.ts 对齐：
// 人物、场景、道具分开；连续分镜钉原文；台词过肩，一场第一镜全景，其余中景；
// 镜长按字数收在 3–15 秒，镜与镜间隔 0.5 秒。不调用模型，不发明画面。

const CN = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};

function cnToInt(s) {
  if (/^[0-9０-９]+$/.test(s)) return Number(s.replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10)));
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + (CN[s.slice(1)] ?? 0);
  if (s.endsWith('十') && s.length === 2) return (CN[s[0]] ?? 0) * 10;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (CN[a] ?? 0) * 10 + (CN[b] ?? 0);
  }
  return CN[s] ?? 0;
}

export function episodeKey(title) {
  const t = String(title || '').replace(/\s+/g, '');
  const m = t.match(/第([0-9０-９一二三四五六七八九十百两〇零]+)集/);
  if (!m) return t || '1';
  return String(cnToInt(m[1]) || 1);
}

/** 与分镜站 split-episodes.ts 同一套：标题行、过长梗概、无集标记、中文数字、重复集号。 */
const SPLIT_EPISODE_LINE = /(?:^|\n)[ \t\u3000]*[【〔（(]*[ \t]*第[0-9０-９一二三四五六七八九十百零〇两]+\s*集[)）〕】]?([：:\s\u3000][^\n]*)?/gi;

function isEpisodeHeading(rest) {
  const t = String(rest || '').replace(/^[：:\s\u3000]+/, '').trim();
  if (!t) return true;
  if (t.length > 40) return false;
  if (/[。！？；]/.test(t)) return false;
  return true;
}

function hasSceneBody(chunk) {
  return /(?:^|\n)\s*(?:\d{1,3}\s*[-－]\s*\d{1,3}\s|(?:内景|外景|内\/外)|(?:INT|EXT)\s*\.)/i.test(chunk);
}

export function splitEpisodes(script) {
  const text = preferScriptBody(String(script || '').replace(/\r\n/g, '\n').replace(/\u3000/g, ' ')).trim();
  if (!text) return [];
  const hits = [];
  const re = new RegExp(SPLIT_EPISODE_LINE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const nl = m[0].startsWith('\n') ? 1 : 0;
    const index = m.index + nl;
    const after = text.slice(index + m[0].trim().length);
    const untilNext = after.split(/\n[ \t\u3000]*第[0-9０-９一二三四五六七八九十百零〇两]+\s*集/)[0] ?? after;
    if (!isEpisodeHeading(m[1]) && !hasSceneBody(untilNext.slice(0, 1800))) continue;
    const title = m[0].slice(nl).trim().replace(/[【〔（(] /g, '').replace(/[)）〕】]/g, '').replace(/\s+/g, '');
    const head = title.match(/第[0-9０-９一二三四五六七八九十百零〇两]+集/)?.[0] || title.slice(0, 12);
    hits.push({title: head, index});
  }
  const raw = hits.length === 0
    ? [{title: '第 1 集', script: text}]
    : hits.map((h, i) => ({title: h.title, script: text.slice(h.index, hits[i + 1]?.index).trim()}));
  if (hits.length && hits[0].index > 0 && hasSceneBody(text.slice(0, hits[0].index))) {
    raw.unshift({title: '第1集', script: text.slice(0, hits[0].index).trim()});
  }
  const best = new Map();
  for (const part of raw) {
    if (!part.script) continue;
    const key = episodeKey(part.title);
    const prev = best.get(key);
    if (!prev || part.script.length > prev.script.length) best.set(key, part);
  }
  const parts = [...best.values()];
  return parts.length ? parts : [{title: '第 1 集', script: text}];
}

const SCENE_HEADING = /^(?:第[0-9０-９一二三四五六七八九十百千两〇零]+场|(?:内景|外景|内\/外|外\/内)|(?:INT|EXT|I\/E)\s*\.|\d{1,3}\s*[\-－]\s*\d{1,3})/i;

function isSceneHeading(line) {
  const t = line.trim();
  if (t.length < 2 || t.length > 80) return false;
  return SCENE_HEADING.test(t);
}

function isCue(line, next = '') {
  const t = line.trim();
  if (t.length < 1 || t.length > 24) return false;
  if (/^(?:CUT TO|FADE|SMASH|DISSOLVE|TO:)/i.test(t)) return false;
  if (isSceneHeading(t)) return false;
  if (/^[A-Z][A-Z0-9 .]{0,18}$/.test(t)) return true;
  if (/（(?:OS|V\.?O\.?|画外|内心|电话|轻声|低声|愤怒|哭腔)）/.test(t)) return true;
  if (/^[\u4e00-\u9fff]{2,4}(?:（[^）]{1,16}）)?$/.test(t) && !/[。！？，、：；]/.test(t)) {
    const n = next.trim();
    if (!n || isSceneHeading(n) || isSameLineDialogue(n)) return false;
    return n.length >= t.length;
  }
  return false;
}

function isSameLineDialogue(line) {
  return /^(?:VO\s*)?[\u4e00-\u9fffA-Za-z]{1,12}(?:（[^）]{1,20}）)?[：:]/.test(line.trim());
}

function durationOf(action, dialogue) {
  const n = (action + dialogue).replace(/\s/g, '').length;
  return Math.min(15, Math.max(3, Math.round(n / 12) || 4));
}

export function preferScriptBody(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const shoot = src.search(/(?:^|\n)第[0-9０-９一二三四五六七八九十百两〇零]+\s*集[：:\s\u3000]*[^\n]{0,40}\n\s*\d{1,3}\s*[\-－]\s*\d{1,3}\s/);
  if (shoot >= 0) return src.slice(shoot).trim();
  const epHead = src.search(/(?:^|\n)[ \t\u3000]*第[0-9０-９一二三四五六七八九十百两〇零]+\s*集(?![：:].{41,})/);
  const slug = src.search(/(?:^|\n)\d{1,3}\s*[-－]\s*\d{1,3}\s+\S/);
  if (slug >= 0) {
    if (epHead >= 0 && epHead < slug && slug - epHead < 120) return src.slice(epHead).trim();
    const before = src.lastIndexOf('\n第', slug);
    if (before >= 0 && slug - before < 80) return src.slice(before + 1).trim();
    return src.slice(slug).trim();
  }
  if (epHead >= 0) return src.slice(epHead).trim();
  const outlineAt = src.search(/分集集纲|集纲|分集大纲|本集大纲|故事大纲|分集梗概/);
  const bodyAt = src.search(/(?:^|\n)[ \t]*(?:分场剧本|剧本正文|完成剧本|第[0-9一二三四五六七八九十百两〇零]+场|(?:内景|外景)|INT\.|EXT\.)/m);
  if (outlineAt >= 0 && bodyAt > outlineAt + 8) return src.slice(bodyAt).trim();
  return src.trim();
}

function bibleText(full) {
  const src = String(full || '').replace(/\r\n/g, '\n');
  const shoot = src.search(/(?:^|\n)第[0-9０-９一二三四五六七八九十百两〇零]+\s*集\s*\n\s*\d{1,3}-\d{1,3}\s/);
  const head = shoot > 0 ? src.slice(0, shoot) : src.slice(0, 12000);
  const start = head.search(/外貌|身份[：:]|人物小传|主要人物|角色介绍/);
  const cut = start >= 0 ? head.slice(start) : head;
  return cut.replace(/分集集纲[\s\S]*?(?=外貌|身份[：:]|人物)/, '').trim().slice(-10000);
}

export function characterBible(full) {
  const text = bibleText(full);
  const lines = text.split('\n');
  const blocks = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim().replace(/（[^）]{0,40}）/g, '').trim();
    if (!/^[\u4e00-\u9fffA-Za-z·]{2,8}$/.test(raw)) continue;
    if (/^(年龄|身高|身份|外貌|性格|背景|人物|主要|角色|第)/.test(raw)) continue;
    if (seen.has(raw)) continue;
    const chunk = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
    if (!/外貌|身份[：:]/.test(chunk)) continue;
    const pick = label => {
      const mm = chunk.match(new RegExp(`${label}[：:]?\\s*([^\\n]{2,220})`));
      return (mm?.[1] ?? '').trim();
    };
    const appearance = pick('外貌') || pick('外貌描写');
    const role = pick('身份');
    const age = (pick('年龄') || '').replace(/年龄/, '').slice(0, 20);
    const costume = /常穿([^。\n]{2,80})/.exec(chunk)?.[1] ?? '';
    if (!appearance && !role) continue;
    seen.add(raw);
    blocks.push({name: raw, role: role.slice(0, 40) || '角色', age, appearance: appearance.slice(0, 240), costume: costume.slice(0, 240)});
  }
  return blocks;
}

const CROWD = /若干|精锐|手下|帮众|宾客|工人|众人|群众|路人|人群|围观|保镖们|客人们|们$/;

function cleanPersonName(raw) {
  let n = String(raw || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[“”"'《》]/g, '')
    .replace(/^(?:VO|OS|V\.?O\.?)\s*/i, '')
    .trim();
  n = n.replace(/[、，,]$/g, '').trim();
  if (/\s/.test(n)) return '';
  if (n.length < 2 || n.length > 8) return '';
  if (CROWD.test(n)) return '';
  if (/^(?:CUT TO|FADE|年龄|身高|身份|外貌|性格|背景|人物|场景|地点|时间|场次|第.+场|内景|外景)$/i.test(n)) return '';
  if (/[。！？；]/.test(n)) return '';
  return n;
}

function splitPeople(raw) {
  return String(raw || '').split(/[、，,，/／|｜和与及\s\u3000]+/).map(p => cleanPersonName(p)).filter(Boolean);
}

function isPlaceToken(s) {
  return /家|室|房|厅|楼|街|店|园|馆|院|场|码头|江|河|海|路|桥|港|站|校|厂|寺|庙|包间|甲板|阳台|厨房|卧室|客厅|走廊|卫生间|车库|花园|别墅|办公室|候船|夜总会|医院|学校|公司/.test(s);
}

function looksLikePersonToken(s) {
  const n = s.replace(/（[^）]*）/g, '').trim();
  if (!n || isPlaceToken(n) || CROWD.test(n)) return false;
  if (/^[A-Za-z][A-Za-z0-9·]{1,11}$/.test(n)) return true;
  if (/^[\u4e00-\u9fff]{2,4}$/.test(n)) return true;
  return false;
}

function parseSceneSlug(line) {
  const t = line.trim().replace(/\u3000/g, ' ');
  const m = t.match(/^(\d{1,3}\s*[-－]\s*\d{1,3})\s+(\S+)\s+(\S+)\s+(.+)$/);
  if (!m) return null;
  let rest = m[4].trim();
  let people = [];
  const tagged = /人物[：:]\s*(.+)$/.exec(rest);
  if (tagged) {
    people = splitPeople(tagged[1]);
    rest = rest.slice(0, tagged.index).trim();
  } else {
    const bits = rest.split(/\s+/).filter(Boolean);
    const names = [];
    while (bits.length > 1 && looksLikePersonToken(bits[bits.length - 1])) names.unshift(bits.pop());
    people = names.map(n => cleanPersonName(n)).filter(Boolean);
    rest = bits.join(' ');
  }
  return {
    time: m[2],
    inout: m[3],
    place: rest.slice(0, 60),
    people,
    heading: `${m[1].replace(/\s/g, '')} ${m[2]} ${m[3]} ${rest}`.slice(0, 80),
  };
}

function addName(into, raw, weight = 1) {
  const n = cleanPersonName(raw);
  if (!n) return;
  into.set(n, (into.get(n) ?? 0) + weight);
}

export function charactersFromScript(script) {
  const names = new Map();
  const lines = String(script || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const slug = parseSceneSlug(t);
    if (slug) for (const p of slug.people) addName(names, p, 6);
    const listed = t.match(/人物[：:]\s*(.+)$/);
    if (listed) for (const p of splitPeople(listed[1])) addName(names, p, 6);
  }
  if (!names.size) {
    for (const m of String(script || '').matchAll(/^(?:VO\s*)?([\u4e00-\u9fffA-Za-z·]{2,8})(?:（[^）]{1,20}）)?[：:]/gm)) {
      if (/^人物$/.test(m[1])) continue;
      addName(names, m[1], 2);
    }
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const next = (lines[i + 1] ?? '').trim();
      if (isCue(t, next)) addName(names, t.replace(/（[^）]*）/g, ''), 3);
      const tagged = t.match(/^([\u4e00-\u9fffA-Za-z·]{2,12})（([^）]{2,40})）/);
      if (tagged && /岁|男|女|身份|风衣|制服/.test(tagged[2])) addName(names, tagged[1], 4);
    }
  }
  return [...names.keys()].slice(0, 12).map(name => ({
    name, role: '角色', age: '', gender: '', appearance: '', costume: '', script_refs: [],
  }));
}

export function locationsFromScript(script) {
  const seen = new Map();
  const lines = String(script || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const slug = parseSceneSlug(lines[i]);
    const m = slug ? null : lines[i].trim().match(/^(\d{1,3}-\d{1,3})\s+(\S+)\s+(\S+)\s+(.+)$/);
    const name = (slug?.place || m?.[4]?.replace(/人物[：:].*$/, '').trim() || '').slice(0, 60);
    if (!name || seen.has(name)) continue;
    let description = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const t = lines[j].trim().replace(/^△\s*/, '');
      if (!t || /^人物[：:]/.test(t) || /^道具[：:]/.test(t) || isSceneHeading(t)) continue;
      if (isSameLineDialogue(t)) break;
      description = t.slice(0, 400);
      break;
    }
    seen.set(name, {
      name,
      heading: slug?.heading ?? `${m[1]} ${m[2]} ${m[3]} ${name}`.slice(0, 80),
      time_of_day: slug?.time ?? m[2],
      description,
    });
  }
  return [...seen.values()].slice(0, 8).map(l => ({
    name: l.name,
    heading: l.heading,
    description: l.description,
    time_of_day: l.time_of_day,
    weather: '',
    atmosphere: '',
    script_refs: [],
  }));
}

function mergeChar(base, extra) {
  if (!extra) return base;
  return {
    ...base,
    role: extra.role && extra.role !== '角色' ? extra.role : base.role,
    age: extra.age || base.age,
    appearance: extra.appearance || base.appearance,
    costume: extra.costume || base.costume,
  };
}

export function enrichCharacters(local, fullScript, episodeBody = '') {
  const bible = characterBible(fullScript);
  const body = episodeBody || fullScript;
  const by = new Map(local.map(c => [c.name, {...c}]));
  for (const b of bible) {
    if (!by.has(b.name) && !body.includes(b.name)) continue;
    const cur = by.get(b.name) ?? {name: b.name, role: '角色', age: '', gender: '', appearance: '', costume: '', script_refs: []};
    by.set(b.name, mergeChar(cur, b));
  }
  return [...by.values()].slice(0, 12);
}

function cleanPropName(raw) {
  const n = String(raw || '').replace(/（[^）]*）/g, '').replace(/[。！？；，、].*$/, '').trim();
  if (n.length < 1 || n.length > 12) return '';
  if (CROWD.test(n) || /^(?:人物|场景|道具)$/.test(n)) return '';
  return n;
}

export function propsFromScript(script) {
  const seen = new Map();
  for (const line of String(script || '').split('\n')) {
    const m = line.trim().match(/道具[：:]\s*(.+)$/);
    if (!m) continue;
    for (const part of m[1].split(/[、，,，/／|｜和与及\s\u3000]+/)) {
      const name = cleanPropName(part);
      if (!name || seen.has(name)) continue;
      seen.set(name, {name, category: '道具', description: '', material: '', significance: '', used_by: '', script_refs: []});
    }
  }
  return [...seen.values()].slice(0, 10);
}

const EPISODE_LINE = /^第[0-9０-９一二三四五六七八九十百两〇零]+\s*集$/;

export function beatsFromScript(raw) {
  const script = preferScriptBody(raw);
  if (!script.trim()) return [];
  const lines = script.split('\n');
  const blocks = [];
  let heading = '';
  let episode = '第一集';
  let i = 0;
  let offset = 0;
  const push = b => {
    const action = b.action.trim();
    const dialogue = b.dialogue.trim();
    if (!action && !dialogue) return;
    blocks.push({...b, action, dialogue, heading: b.heading || heading || '分镜', episode: b.episode || episode});
  };
  while (i < lines.length) {
    const line = lines[i];
    const start = offset;
    const end = offset + line.length;
    const trimmed = line.trim();
    const nextTrim = (lines[i + 1] ?? '').trim();
    if (!trimmed || /^《.+》$/.test(trimmed)) {
      i++; offset = end + 1; continue;
    }
    if (EPISODE_LINE.test(trimmed)) {
      episode = trimmed.replace(/\s/g, '');
      i++; offset = end + 1; continue;
    }
    if (/^人物[：:]/.test(trimmed) || /^道具[：:]/.test(trimmed)) {
      i++; offset = end + 1; continue;
    }
    if (isSceneHeading(trimmed)) {
      heading = trimmed.replace(/人物[：:].*$/, '').replace(/道具[：:].*$/, '').trim().slice(0, 80);
      i++; offset = end + 1; continue;
    }
    if (isSameLineDialogue(trimmed)) {
      push({heading, episode, action: '', dialogue: trimmed, start, end});
      i++; offset = end + 1; continue;
    }
    if (isCue(trimmed, nextTrim)) {
      const speaker = trimmed;
      const dlg = [];
      let last = end;
      i++; offset = end + 1;
      while (i < lines.length) {
        const n = lines[i];
        const nt = n.trim();
        if (!nt) break;
        if (isSceneHeading(nt) || isCue(nt, (lines[i + 1] ?? '').trim()) || isSameLineDialogue(nt) || /^人物[：:]/.test(nt) || /^道具[：:]/.test(nt)) break;
        dlg.push(nt);
        last = offset + n.length;
        i++; offset = last + 1;
      }
      push({heading, episode, action: '', dialogue: `${speaker}\n${dlg.join('\n')}`.trim(), start, end: last});
      continue;
    }
    const act = trimmed.replace(/^△\s*/, '');
    const rest = [act];
    let last = end;
    i++; offset = end + 1;
    while (i < lines.length) {
      const n = lines[i];
      const nt = n.trim();
      if (!nt) break;
      if (isSceneHeading(nt) || isCue(nt, (lines[i + 1] ?? '').trim()) || isSameLineDialogue(nt) || /^人物[：:]/.test(nt) || /^道具[：:]/.test(nt) || /^△/.test(nt)) break;
      if (rest.join('').length > 280) break;
      rest.push(nt.replace(/^△\s*/, ''));
      last = offset + n.length;
      i++; offset = last + 1;
    }
    push({heading, episode, action: rest.join('\n'), dialogue: '', start, end: last});
  }
  const usable = blocks.filter(b => b.action || b.dialogue);
  if (!usable.length) return [];
  let t = 0;
  return usable.slice(0, 80).map((b, idx, arr) => {
    const dur = durationOf(b.action, b.dialogue);
    const start = t;
    t += dur;
    const excerpt = (b.dialogue || b.action || b.heading).replace(/\s+/g, ' ').slice(0, 120);
    const firstOfScene = idx === 0 || b.heading !== arr[idx - 1]?.heading;
    return {
      seq: idx + 1,
      episode: b.episode || '第一集',
      scene_heading: b.heading || '分镜',
      action: b.action.slice(0, 2000),
      dialogue: b.dialogue.slice(0, 800),
      shot_type: b.dialogue ? '过肩镜头' : firstOfScene ? '全景' : '中景',
      start_sec: start,
      duration_sec: dur,
      next_gap_sec: idx === arr.length - 1 ? 0 : 0.5,
      script_char_start: b.start,
      script_char_end: Math.max(b.end, b.start),
      script_excerpt: excerpt,
      continuity_notes: '',
      ots_from: '',
      ots_to: '',
      ots_block: '',
    };
  });
}

export function breakScript(raw) {
  const full = String(raw ?? '').replace(/\r\n/g, '\n');
  const body = preferScriptBody(full);
  return {
    body,
    characters: enrichCharacters(charactersFromScript(body), full, body),
    locations: locationsFromScript(body),
    props: propsFromScript(body),
    beats: beatsFromScript(body),
  };
}
