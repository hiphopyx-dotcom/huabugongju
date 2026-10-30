import {LOOK_STYLES} from './image-workflow.mjs';

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

export function parseAssetsPrompt({title = '', script = '', bible = '', visualStyle = 'cinematic'} = {}) {
  const style = LOOK_STYLES.find(item => item.id === visualStyle) || LOOK_STYLES.find(item => item.id === 'cinematic');
  const system = `你是华语电影分镜导演。只拆本集出场的人物、场景、道具。只输出一个 JSON 对象。

硬性约束：
- 人物必须是单独一个人，appearance / costume 只写这一个，禁止把两个角色写进同一条，禁止 name 写成「A和B」
- name 必须是剧本对白或「人物：」里出现的真名（2–8 字），不要路人、保镖若干、群众
- 只收本集出场的人（对白或动作里出现的），对照人物小传补外貌和服装；没出场的小传人物不要列
- 场景按场次地点收，description 写空间里能看见什么（墙、门、窗外、道具陈设），写清日夜内外
- 道具只收会影响剧情或出特写的物件（枪、账本、钥匙、地图、对讲机…），不要列桌子椅子除非剧本强调
- style_lock 只写光色、胶片、天气、镜头质感
- 视觉风格：${style?.label ?? visualStyle}（${style?.hint ?? ''}）
- characters ≤ 12，locations ≤ 8，props ≤ 10

JSON：
{
  "title": "",
  "logline": "",
  "style_lock": "",
  "characters": [{"name","role","age","gender","appearance","costume","script_refs":[{"start","end","excerpt"}]}],
  "locations": [{"name","heading","description","time_of_day","weather","atmosphere","script_refs":[...]}],
  "props": [{"name","category","description","material","significance","used_by","script_refs":[...]}]
}`;
  const user = `片名：${title || '未定'}\n\n${bible ? `人物小传：\n${String(bible).slice(0, 6000)}\n\n` : ''}本集分场剧本：\n${script}`;
  return {system, user};
}

/** 与分镜站 parseAssets 拿到模型 JSON 之后的同一套清洗。不调用接口。 */
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
