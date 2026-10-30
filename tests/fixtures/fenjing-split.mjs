// fenjing-src/src/lib/screenplay.ts
var CN = {
  \u96F6: 0,
  "\u3007": 0,
  \u4E00: 1,
  \u4E8C: 2,
  \u4E24: 2,
  \u4E09: 3,
  \u56DB: 4,
  \u4E94: 5,
  \u516D: 6,
  \u4E03: 7,
  \u516B: 8,
  \u4E5D: 9,
  \u5341: 10
};
function cnToInt(s) {
  if (/^[0-9０-９]+$/.test(s)) return Number(s.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 65296)));
  if (s === "\u5341") return 10;
  if (s.startsWith("\u5341")) return 10 + (CN[s.slice(1)] ?? 0);
  if (s.endsWith("\u5341") && s.length === 2) return (CN[s[0]] ?? 0) * 10;
  if (s.includes("\u5341")) {
    const [a, b] = s.split("\u5341");
    return (CN[a] ?? 0) * 10 + (CN[b] ?? 0);
  }
  return CN[s] ?? 0;
}
function episodeKey(title) {
  const t = title.replace(/\s+/g, "");
  const m = t.match(/第([0-9０-９一二三四五六七八九十百两〇零]+)集/);
  if (!m) return t || "1";
  return String(cnToInt(m[1]) || 1);
}
function preferScriptBody(text) {
  const src = text.replace(/\r\n/g, "\n");
  const shoot = src.search(
    /(?:^|\n)第[0-9０-９一二三四五六七八九十百两〇零]+\s*集[：:\s\u3000]*[^\n]{0,40}\n\s*\d{1,3}\s*[\-－]\s*\d{1,3}\s/
  );
  if (shoot >= 0) return src.slice(shoot).trim();
  const epHead = src.search(/(?:^|\n)[ \t\u3000]*第[0-9０-９一二三四五六七八九十百两〇零]+\s*集(?![：:].{41,})/);
  const slug = src.search(/(?:^|\n)\d{1,3}\s*[-－]\s*\d{1,3}\s+\S/);
  if (slug >= 0) {
    if (epHead >= 0 && epHead < slug && slug - epHead < 120) return src.slice(epHead).trim();
    const before = src.lastIndexOf("\n\u7B2C", slug);
    if (before >= 0 && slug - before < 80) return src.slice(before + 1).trim();
    return src.slice(slug).trim();
  }
  if (epHead >= 0) return src.slice(epHead).trim();
  const outlineAt = src.search(/分集集纲|集纲|分集大纲|本集大纲|故事大纲|分集梗概/);
  const bodyAt = src.search(
    /(?:^|\n)[ \t]*(?:分场剧本|剧本正文|完成剧本|第[0-9一二三四五六七八九十百两〇零]+场|(?:内景|外景)|INT\.|EXT\.)/m
  );
  if (outlineAt >= 0 && bodyAt > outlineAt + 8) return src.slice(bodyAt).trim();
  return src.trim();
}

// fenjing-src/src/lib/split-episodes.ts
var EPISODE_LINE = /(?:^|\n)[ \t\u3000]*[【〔（(]*[ \t]*第[0-9０-９一二三四五六七八九十百零〇两]+\s*集[)）〕】]?([：:\s\u3000][^\n]*)?/gi;
function isEpisodeHeading(rest) {
  const t = (rest || "").replace(/^[：:\s\u3000]+/, "").trim();
  if (!t) return true;
  if (t.length > 40) return false;
  if (/[。！？；]/.test(t)) return false;
  return true;
}
function hasSceneBody(chunk) {
  return /(?:^|\n)\s*(?:\d{1,3}\s*[-－]\s*\d{1,3}\s|(?:内景|外景|内\/外)|(?:INT|EXT)\s*\.)/i.test(chunk);
}
function splitEpisodes(script) {
  const text = preferScriptBody(script.replace(/\r\n/g, "\n").replace(/\u3000/g, " ")).trim();
  if (!text) return [];
  const hits = [];
  const re = new RegExp(EPISODE_LINE.source, "gi");
  let m;
  while (m = re.exec(text)) {
    const nl = m[0].startsWith("\n") ? 1 : 0;
    const index = m.index + nl;
    const after = text.slice(index + m[0].trim().length);
    const untilNext = after.split(/\n[ \t\u3000]*第[0-9０-９一二三四五六七八九十百零〇两]+\s*集/)[0] ?? after;
    if (!isEpisodeHeading(m[1]) && !hasSceneBody(untilNext.slice(0, 1800))) continue;
    const title = m[0].slice(nl).trim().replace(/[【〔（(] /g, "").replace(/[)）〕】]/g, "").replace(/\s+/g, "");
    const head = title.match(/第[0-9０-９一二三四五六七八九十百零〇两]+集/)?.[0] || title.slice(0, 12);
    hits.push({ title: head, index });
  }
  const raw = hits.length === 0 ? [{ title: "\u7B2C 1 \u96C6", script: text }] : hits.map((h, i) => ({
    title: h.title,
    script: text.slice(h.index, hits[i + 1]?.index).trim()
  }));
  if (hits.length && hits[0].index > 0 && hasSceneBody(text.slice(0, hits[0].index))) {
    raw.unshift({ title: "\u7B2C1\u96C6", script: text.slice(0, hits[0].index).trim() });
  }
  const best = /* @__PURE__ */ new Map();
  for (const part of raw) {
    if (!part.script) continue;
    const key = episodeKey(part.title);
    const prev = best.get(key);
    if (!prev || part.script.length > prev.script.length) best.set(key, part);
  }
  const parts = [...best.values()];
  return parts.length ? parts : [{ title: "\u7B2C 1 \u96C6", script: text }];
}
export {
  splitEpisodes
};
