/** 从分镜站 xai-studio.ts parseAssets 的 JSON 清洗原样转写，供对照。不引用工作台模块。 */
function extractJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.search(/[{[]/);
  if (start < 0) throw Error('模型没有返回可解析的 JSON');
  let depth = 0, end = -1, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw Error('JSON 不完整');
  return JSON.parse(text.slice(start, end + 1));
}

function refsOf(value, script) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const excerpt = String(item?.excerpt ?? '').slice(0, 240);
    let start = Number(item?.start ?? item?.script_char_start ?? -1);
    let end = Number(item?.end ?? item?.script_char_end ?? -1);
    if (!(start >= 0 && end > start) && excerpt) {
      const i = script.indexOf(excerpt.slice(0, 24));
      if (i >= 0) { start = i; end = Math.min(script.length, i + excerpt.length); }
    }
    if (!(start >= 0 && end > start)) return null;
    return {start, end: Math.min(script.length, end), excerpt: excerpt || script.slice(start, Math.min(end, start + 80))};
  }).filter(Boolean).slice(0, 6);
}

export function normalizeParseAssets(raw, input = {}) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  const script = String(input.script || '');
  const characters = (Array.isArray(parsed?.characters) ? parsed.characters : []).map(item => {
    const name = String(item?.name ?? '').trim().slice(0, 12);
    if (!name || /[和与、]/.test(name) || /若干|众人|群众|路人/.test(name)) return null;
    return {
      name,
      role: String(item?.role ?? '角色').slice(0, 40),
      age: String(item?.age ?? '').slice(0, 20),
      gender: String(item?.gender ?? '').slice(0, 20),
      appearance: String(item?.appearance ?? '').slice(0, 240),
      costume: String(item?.costume ?? '').slice(0, 240),
      script_refs: refsOf(item?.script_refs, script),
    };
  }).filter(Boolean).slice(0, 12);
  const locations = (Array.isArray(parsed?.locations) ? parsed.locations : []).slice(0, 8).map(item => ({
    name: String(item?.name ?? '未命名场景').slice(0, 60),
    heading: String(item?.heading ?? '').slice(0, 80),
    description: String(item?.description ?? '').slice(0, 400),
    time_of_day: String(item?.time_of_day ?? '').slice(0, 40),
    weather: String(item?.weather ?? '').slice(0, 40),
    atmosphere: String(item?.atmosphere ?? '').slice(0, 80),
    script_refs: refsOf(item?.script_refs, script),
  }));
  const props = (Array.isArray(parsed?.props) ? parsed.props : []).slice(0, 10).map(item => ({
    name: String(item?.name ?? '道具').slice(0, 40),
    category: String(item?.category ?? '道具').slice(0, 40),
    description: String(item?.description ?? '').slice(0, 400),
    material: String(item?.material ?? '').slice(0, 120),
    significance: String(item?.significance ?? '').slice(0, 160),
    used_by: String(item?.used_by ?? '').slice(0, 80),
    script_refs: refsOf(item?.script_refs, script),
  }));
  return {
    title: String(parsed?.title || input.title || '未命名').slice(0, 80),
    logline: String(parsed?.logline ?? '').slice(0, 240),
    style_lock: String(parsed?.style_lock ?? '').slice(0, 1200),
    characters,
    locations,
    props,
  };
}
