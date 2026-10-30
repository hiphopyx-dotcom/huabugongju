// 连续分镜的插入和排序。查找时不能拖。保存失败由调用方提示「顺序没保存」。

export const ORDER_UNSAVED = '顺序没保存';
const LANGUAGE = ['shot_size','composition','framing','camera_move','stylize','lighting','technique','ots_from','ots_to'];

export function sceneCode(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/(\d+)\s*[-–—]\s*(\d+)/);
  return m ? `${m[1]}-${m[2]}` : (raw.split(/\s+/)[0] || '未标场号');
}

export function dragEnabled(query) {
  return !String(query || '').trim();
}

function cloneBeat(beat) {
  return {
    ...beat,
    characterNames: [...(beat.characterNames || [])],
    locationNames: [...(beat.locationNames || [])],
    propNames: [...(beat.propNames || [])],
  };
}

function numbered(list) {
  return list.map((beat, index) => ({...beat, seq: index + 1}));
}

function blankFrom(after, id) {
  const beat = after ? cloneBeat(after) : {
    episode: '', scene_heading: '新一段', action: '', dialogue: '', shot_type: '中景',
    script_excerpt: '', continuity_notes: '', characterNames: [], locationNames: [], propNames: [],
  };
  beat.id = id;
  beat.duration_sec = 4;
  beat.next_gap_sec = 0.5;
  beat.start_sec = after ? Number(after.start_sec || 0) + Number(after.duration_sec || 4) : 0;
  delete beat.frameAssetId;
  delete beat.reverseAssetId;
  for (const key of LANGUAGE) if (beat[key] === undefined) beat[key] = after?.[key] || '';
  return beat;
}

/** 在 afterId 后插入一镜，复制场次、动作和镜头语言。没给 afterId 就加在末尾。 */
export function insertBeatAfter(beats, afterId, createId) {
  const list = beats.map(cloneBeat);
  const index = afterId ? list.findIndex(beat => beat.id === afterId) : list.length - 1;
  if (afterId && index < 0) throw Error('找不到插入位置');
  const after = index >= 0 ? list[index] : null;
  list.splice(Math.max(index, -1) + 1, 0, blankFrom(after, createId()));
  return numbered(list);
}

function sceneGroups(beats) {
  const groups = [];
  for (const beat of beats) {
    const code = sceneCode(beat.scene_heading);
    const last = groups[groups.length - 1];
    if (!last || last.code !== code) groups.push({code, beats: [beat]});
    else last.beats.push(beat);
  }
  return groups;
}

function writeEpisode(beats, episode, nextBeats) {
  const out = [];
  let used = false;
  for (const beat of beats) {
    if ((beat.episode || '') !== episode) { out.push(beat); continue; }
    if (!used) { out.push(...nextBeats); used = true; }
  }
  if (!used) out.push(...nextBeats);
  return numbered(out);
}

export function insertSceneAfter(beats, episode, afterCode, createId) {
  const current = beats.filter(beat => (beat.episode || '') === episode).map(cloneBeat);
  const groups = sceneGroups(current);
  const beat = blankFrom(null, createId());
  beat.episode = episode;
  beat.scene_heading = uniqueHeading(groups.map(group => group.code), '新场');
  beat.shot_size = '全景';
  let at = groups.length;
  if (afterCode) {
    const index = groups.findIndex(group => group.code === afterCode);
    if (index < 0) throw Error(ORDER_UNSAVED);
    at = index + 1;
  }
  groups.splice(at, 0, {code: sceneCode(beat.scene_heading), beats: [beat]});
  return writeEpisode(beats, episode, groups.flatMap(group => group.beats));
}

function uniqueHeading(codes, base) {
  if (!codes.includes(base)) return base;
  let n = 2;
  while (codes.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function moveSceneBlock(beats, episode, fromCode, toCode) {
  if (fromCode === toCode) return beats.map(cloneBeat);
  const current = beats.filter(beat => (beat.episode || '') === episode).map(cloneBeat);
  const groups = sceneGroups(current);
  const from = groups.findIndex(group => group.code === fromCode);
  const to = groups.findIndex(group => group.code === toCode);
  if (from < 0 || to < 0) throw Error(ORDER_UNSAVED);
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  return writeEpisode(beats, episode, groups.flatMap(group => group.beats));
}

export function moveBeat(beats, episode, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return beats.map(cloneBeat);
  const current = beats.filter(beat => (beat.episode || '') === episode).map(cloneBeat);
  const from = current.findIndex(beat => beat.id === fromId);
  const to = current.findIndex(beat => beat.id === toId);
  if (from < 0 || to < 0) throw Error(ORDER_UNSAVED);
  const [moved] = current.splice(from, 1);
  current.splice(to, 0, moved);
  return writeEpisode(beats, episode, current);
}
