import {axisPrompt} from './pianchang-axis.mjs';
// Lossless bridge between the film-set desk and the existing project/image store.
import {breakScript, preferScriptBody, episodeKey, splitEpisodes} from './pianchang-parse.mjs';
import {deriveImageEntities, buildWorkflowPrompt, IMAGE_SLOTS} from './image-workflow.mjs';
import {shotsFromBreak} from './script-breakdown.mjs';
import {groups as languageGroups} from './storyboard.mjs';
import {episodeAspectOf} from './frame-aspect.mjs';
import {coverageSlot} from './ots-coverage.mjs';

export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function imageURL(src) {
  if (typeof src !== 'string') return '';
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return src;
  if (/^\/api\/images\?/.test(src)) {
    const u = new URL(src, 'https://local.invalid');
    if (u.searchParams.get('action') === 'content' && /^[a-z0-9_-]{1,128}$/i.test(u.searchParams.get('id') || '') && [...u.searchParams.keys()].every(k => ['action','id','download'].includes(k))) return u.pathname + u.search;
  }
  return '';
}
export const contentURL = id => /^[a-z0-9_-]{1,128}$/i.test(id || '') ? '/api/images?' + new URLSearchParams({action:'content',id}) : '';
function normalizedMap(full) {
  let norm = '';
  const map = [];
  for (let i = 0; i < full.length; i++) {
    if (full[i] === '\r' && full[i + 1] === '\n') continue;
    norm += full[i] === '\u3000' ? ' ' : full[i];
    map.push(i);
  }
  return {norm, map};
}
export function scriptEpisodes(script) {
  const full = String(script || '');
  const parts = splitEpisodes(full);
  if (!parts.length) return [{name:'第一集',text:full,start:0,end:full.length}];
  const {norm, map} = normalizedMap(full);
  const used = preferScriptBody(full.replace(/\r\n/g, '\n').replace(/\u3000/g, ' ')).trim();
  const bodyAt = Math.max(0, norm.indexOf(used));
  const atOrig = index => index >= map.length ? full.length : map[index];
  let cursor = 0;
  return parts.map((part, i) => {
    const at = Math.max(0, used.indexOf(part.script, cursor));
    const startNorm = bodyAt + at;
    const nextAt = i + 1 < parts.length ? used.indexOf(parts[i + 1].script, at + part.script.length) : used.length;
    const endNorm = bodyAt + (nextAt < 0 ? at + part.script.length : nextAt);
    cursor = at + part.script.length;
    const start = atOrig(startNorm), end = atOrig(endNorm);
    return {name: part.title, text: full.slice(start, end), start, end};
  });
}
export function scriptWindow(p, all=false) {
  if(all)return {name:'全剧',text:String(p.script || ''),start:0,end:String(p.script || '').length};
  return scriptEpisodes(p.script).find(e=>e.name===p.pianchang?.episode) || scriptEpisodes(p.script)[0];
}
export function applyScriptDraft(p,key) {
  const d=p.pianchang, draft=d.scriptDrafts?.[key]; if(!draft)return false;
  const part=scriptWindow(p,key==='@all');
  if(part.text!==draft.source)throw Error('原文已在其他页面更新，请先还原草稿，再重新编辑');
  if(draft.text.length>300000)throw Error('剧本请控制在30万字以内');
  if(draft.text!==part.text){
    (d.scriptHistory ||= []).push({text:p.script,created:Date.now()});
    p.script=String(p.script || '').slice(0,part.start)+draft.text+(part.end<String(p.script || '').length && draft.text && !draft.text.endsWith('\n')?'\n':'')+String(p.script || '').slice(part.end);
  }
  delete d.scriptDrafts[key];
  if(!scriptEpisodes(p.script).some(e=>e.name===d.episode))d.episode=scriptEpisodes(p.script)[0].name;
  return true;
}
const groups = ['characters','locations','props'];
function canonicalEpisode(p,value) {
  const episodes=scriptEpisodes(p.script),name=String(value || '');
  if(!name || name==='本集' || name==='未分集')return episodes[0].name;
  return episodes.find(e=>episodeKey(e.name)===episodeKey(name))?.name || name.match(/第\s*[零〇一二两三四五六七八九十百０-９\d]+\s*集/)?.[0].replace(/\s/g,'') || name;
}
const beatFields = {scene:'scene_heading',description:'action',dialogue:'dialogue',duration:'duration_sec',nextGap:'next_gap_sec',startSec:'start_sec',size:'shot_size',angle:'composition',framing:'framing',camera:'camera_move',stylize:'stylize',lighting:'lighting',technique:'technique',sourceText:'script_excerpt',otsBlock:'ots_block',assetId:'frameAssetId',reverseAssetId:'reverseAssetId',continuity:'continuity',ratio:'ratio'};
const signature = s => JSON.stringify([episodeKey(s.episode || '第一集'),s.scene || s.scene_heading || '',s.sourceText || s.script_excerpt || '']);
const snapshot = p => JSON.stringify(p.shots || []);
export function ensureDesk(p, uid) {
  p.assets ||= []; p.shots ||= []; p.settings ||= {};
  const d = p.pianchang ||= {v:1,tab:'script',aspect:p.settings.ratio || '16:9',resolution:'1k',look:p.imageWorkspace?.style || 'cinematic',forceChar:false,scope:'all'};
  d.episodeAspects ||= {};
  for (const k of [...groups,'beats','archivedShots']) d[k] ||= [];
  for (const k of ['stills','history','grades','images','slotRefs','slotGrades','prompts','pending']) d[k] ||= {};
  if (Array.isArray(d.fuse)) d.fuse = {characters:d.fuse,locations:[],props:[],storyboard:[]};
  d.fuse ||= {};
  // The canonical shot table can also be changed by AI breakdown, writing handoff,
  // project restore, and older screens. Never replace it merely by opening a tab.
  if (d.shotSnapshot !== snapshot(p)) {
    const previous = new Map(d.beats.map(b => [b.id,b]));
    d.beats = p.shots.map((s,i) => {
      const b = {...previous.get(s.id),id:s.id,seq:i+1,episode:canonicalEpisode(p,s.episode)};
      for (const [from,to] of Object.entries(beatFields)) if (s[from] !== undefined) b[to] = s[from];
      b.shot_size ||= '中景'; b.composition ||= '眼睛平视'; b.duration_sec ||= 4;
      for (const k of ['characterNames','locationNames','propNames']) b[k] = s[k] || b[k] || [];
      for (const [slot,key] of [['frame','assetId'],['reverse','reverseAssetId']]) {
        const a = p.assets.find(a => a.id === s[key]);
        if (a && imageURL(a.src)) d.stills[`${s.id}:${slot}`] = a.src;
      }
      return b;
    });
    d.shotSnapshot = snapshot(p);
  }
  // Retain previous imported workspace IDs so cloud images keep their bindings.
  const entities = deriveImageEntities(p,uid);
  for (const e of entities.filter(e => groups.includes(e.category))) {
    e.episode = canonicalEpisode(p,e.episode);
    let row = d[e.category].find(r => r.id === e.id || (r.name === e.name || e.category === 'locations' && r.heading && r.heading === e.name) && r.scope === e.scope && (r.scope === 'series' || r.episode === e.episode));
    if (!row) { row = {id:e.id,name:e.name,scope:e.scope,episode:e.episode,...e.fields}; d[e.category].push(row); }
    if (row.id !== e.id) row.aliases = [...new Set([...(row.aliases || []),e.id])];
    for (const [a,b] of [['timeOfDay','time_of_day'],['usedBy','used_by'],['worldAnchors','world_anchors']]) if (!row[b] && row[a]) row[b] = row[a];
  }
  const episodes = episodeNames(p);
  d.episode = canonicalEpisode(p,d.episode);
  if (!episodes.includes(d.episode)) d.episode = episodes[0] || '第一集';
  for (const category of groups) for (const row of d[category]) row.episode = canonicalEpisode(p,row.episode || d.episode);
  for (const a of p.assets.filter(a => a.kind === 'image' && a.metadata?.entityId && a.metadata?.slot)) {
    const key = `${a.metadata.entityId}:${a.metadata.slot}`;
    if (!d.stills[key] && imageURL(a.src)) d.stills[key] = a.src;
  }
  return d;
}
export function episodeNames(p) { return [...new Set([...scriptEpisodes(p.script).map(e=>e.name),...(p.shots || []).map(s=>canonicalEpisode(p,s.episode)),...(p.pianchang?.beats || []).map(b=>canonicalEpisode(p,b.episode))])]; }
export const visibleRows = (d,rows) => rows.filter(r => !r.archived && (r.scope === 'series' || (r.episode || d.episode) === d.episode) && (d.scope === 'all' || r.scope === d.scope));
export function syncShots(p,d) {
  const old = new Map(p.shots.map(s=>[s.id,s]));
  p.shots = d.beats.map(b => {
    const s = {...old.get(b.id),id:b.id,episode:b.episode || d.episode,subtitle:old.get(b.id)?.subtitle || ''};
    if(old.get(b.id)?.episode && old.get(b.id).episode!==s.episode)s.sourceEpisode ||= old.get(b.id).episode;
    for (const [to,from] of Object.entries(beatFields)) if (b[from] !== undefined) s[to] = b[from];
    s.scene ||= '分镜'; s.description ??= ''; s.dialogue ??= ''; s.duration = Math.min(60,Math.max(.5,Number(s.duration)||4));
    for (const k of ['characterNames','locationNames','propNames']) if (b[k]) s[k] = [...b[k]];
    return s;
  });
  d.shotSnapshot = snapshot(p);
}
export function parseEpisode(p,uid) {
  const d = ensureDesk(p,uid), selected = scriptEpisodes(p.script).find(e=>e.name === d.episode);
  if (!selected?.text.trim()) throw Error('请先导入这一集的剧本');
  const parsed = breakScript(selected.text);
  const all = breakScript(p.script);
  if (!parsed.beats.length) throw Error('没有找到可拆解的动作或对白，请检查场次和换行');
  for (const category of groups) {
    const live = new Set();
    for (const item of parsed[category]) {
      const prev = d[category].find(r=>r.name === item.name && (r.scope === 'series' || r.episode === d.episode));
      const enriched = category === 'characters' ? {...item,...all.characters.find(c=>c.name === item.name)} : item;
      const row = prev || {id:uid(),scope:'episode',episode:d.episode};
      for (const [k,v] of Object.entries(enriched)) if (!row[k]) row[k] = v;
      row.archived = false;
      if (!prev) d[category].push(row);
      live.add(row.id);
    }
    for (const row of d[category]) if (row.scope !== 'series' && row.episode === d.episode && !live.has(row.id)) row.archived = true;
  }
  const old = d.beats.filter(b=>b.episode === d.episode), used = new Set();
  const rows = shotsFromBreak(parsed).map((s,i) => {
    s.episode = d.episode;
    // Match by exact episode, scene, source and occurrence. Position is not identity.
    const prev = old.find(b=>!used.has(b.id) && signature(b) === signature(s));
    if (prev) used.add(prev.id);
    const b = {id:prev?.id || uid(),seq:i+1,episode:d.episode};
    for (const [from,to] of Object.entries(beatFields)) if (s[from] !== undefined) b[to] = s[from];
    Object.assign(b,prev || {},{id:b.id,seq:i+1,episode:d.episode,characterNames:s.characterNames,locationNames:s.locationNames,propNames:s.propNames});
    b.framing ||= '三分构图'; b.stylize ||= '电影叙事'; b.lighting ||= '电影级布光';
    return b;
  });
  const removed = old.filter(b=>!used.has(b.id));
  for (const b of removed) if (!d.archivedShots.some(x=>x.id === b.id)) d.archivedShots.push({...b,shot:p.shots.find(s=>s.id === b.id)});
  const before = d.beats.findIndex(b=>b.episode === d.episode);
  const rest = d.beats.filter(b=>b.episode !== d.episode);
  rest.splice(before < 0 ? rest.length : before,0,...rows); d.beats = rest;
  syncShots(p,d); d.tab = 'breakdown';
  p.breakdown = {...parsed,script:p.script,episode:d.episode,method:'pianchang'};
  return parsed;
}
export function entityFor(d,category,id) { return (category === 'storyboard' ? d.beats : d[category])?.find(e=>e.id === id); }
export function slotImage(p,d,key) {
  const item = d.images[key];
  const a = p.assets.find(a=>a.id === item?.id || a.imageLibraryId === item?.id || imageURL(a.src) && a.src === d.stills[key]);
  const control = p.adminAssetControls?.[item?.id || a?.id];
  if (control?.deleted) return {src:'',locked:true};
  return {item,asset:a,src:imageURL(d.stills[key]) || contentURL(item?.id),locked:!!(item?.adminLocked || a?.adminLocked || a?.locked || control?.locked)};
}
export function acceptImage(p,d,key,item) {
  if (!contentURL(item?.id)) throw Error('图片记录无效');
  const old = d.images[key];
  if (old?.id && old.id !== item.id) d.history[key] = [...(d.history[key] || []),old];
  d.images[key] = item; d.stills[key] = contentURL(item.id); d.prompts[key] = item.prompt || d.prompts[key] || '';
}
function reference(p,d,id,slot) {
  const key = `${id}:${slot}`, image = slotImage(p,d,key);
  if (!image.src) return null;
  return image.item?.id ? {id:image.item.id} : image.asset?.imageLibraryId ? {id:image.asset.imageLibraryId} : /^data:/.test(image.src) ? {dataUrl:image.src} : null;
}
export function prepareStill(p,d,category,id,slot) {
  const row = entityFor(d,category,id);
  const extraLocation=['a_establishing','a_plan','a_view_w','a_view_e','a_view_s','pano'];
  if (!row || !(IMAGE_SLOTS[category]?.some(s=>s.id === slot) || category==='locations' && extraLocation.includes(slot))) throw Error('图片位置已变化，请重新选择');
  const key = `${id}:${slot}`;
  if (slotImage(p,d,key).locked) throw Error('管理员已锁定此图片，仍可查看和使用');
  const canonical = {id:row.id,name:row.name || row.scene_heading || '分镜',category,scope:row.scope || 'episode',episode:row.episode || d.episode,fields:{...row,usedBy:row.used_by,timeOfDay:row.time_of_day,worldAnchors:row.world_anchors}};
  if (category === 'locations') canonical.fields.extraPrompt = [row.extraPrompt,...Object.entries({shot_size:'size',composition:'angle',camera_move:'camera',lighting:'lighting'}).map(([field,key])=>{
    const group=languageGroups.find(g=>g[0]===key),value=row[field];if(!group||!value)return '';const option=group[2].find(o=>o.id===value);return `${group[1]}：${value}${option?' / '+option.prompt:''}`;
  })].filter(Boolean).join('\n');
  if (category === 'props' && row.significance) canonical.fields.extraPrompt = [row.extraPrompt,'叙事功能：'+row.significance].filter(Boolean).join('\n');
  const refs = [];
  const add = r => { if (r && !refs.some(x=>JSON.stringify(x) === JSON.stringify(r))) refs.push(r); };
  let view = p;
  if (category === 'characters' && slot !== 'front') add(reference(p,d,id,'front'));
  if (category === 'locations' && String(slot).startsWith('a_')) { if (slot !== 'a_establishing') add(reference(p,d,id,'a_establishing')); if (slot !== 'a_plan') add(reference(p,d,id,'a_plan')); }
  else if (category === 'locations' && slot !== 'plan' && slot !== 'pano') { add(reference(p,d,id,'plan')); if (slot !== 'view_n') add(reference(p,d,id,'view_n')); }
  if (category === 'storyboard') {
    const source = p.shots.find(s=>s.id === id);
    if (!source) throw Error('对应分镜已不存在');
    const shot = {...source,otsBlock:axisPrompt(row.ots_block,d.characters.find(c=>c.id===row.ots_from)?.name || 'A',d.characters.find(c=>c.id===row.ots_to)?.name || 'B')}, assets = [...p.assets];
    const chosen = new Map();
    for (const group of groups) {
      const namesKey = {characters:'characterNames',locations:'locationNames',props:'propNames'}[group];
      const selected = d[group].filter(e=>!e.archived && (e.scope === 'series' || e.episode === row.episode) && (source[namesKey] || []).includes(e.name));
      shot[group] = [...(source[group] || [])];
      for (const e of selected) {
        const baseChoice = row.refChoices?.[e.id] || (group === 'characters' ? 'front' : group === 'locations' ? 'view_n' : 'hero');
        const choice = group === 'locations' ? coverageSlot(slot, baseChoice, !!reference(p,d,e.id,'pano')) : baseChoice;
        chosen.set(e.id, choice);
        const r = reference(p,d,e.id,choice); if (!r) continue;
        const aid = `ref-${e.id}`;
        assets.push({id:aid,name:e.name,kind:'image',src:slotImage(p,d,`${e.id}:${choice}`).src});
        shot[group].push(aid);
      }
    }
    for (const [field,key] of [['otsFrom','ots_from'],['otsTo','ots_to']]) {
      const c = d.characters.find(c=>c.id === row[key]);
      if (c) {
        const ref = reference(p,d,c.id,row.refChoices?.[c.id] || 'front');
        if (!ref) throw Error('请先生成过肩两个人物的主参考图');
        const aid = `ref-${c.id}`;
        if (!assets.some(a=>a.id === aid)) assets.push({id:aid,name:c.name,kind:'image',src:slotImage(p,d,`${c.id}:front`).src});
        shot[field] = aid;
      }
    }
    // Identity and scene references first. Existing shot output is not its own brief.
    const ordered = [...(shot.angle === '过肩镜头' ? [shot.otsFrom,shot.otsTo] : []),...(shot.characters || []),...(shot.locations || []),...(shot.props || [])];
    for (const aid of [...new Set(ordered)]) {
      const c = d.characters.find(c=>`ref-${c.id}` === aid), l = d.locations.find(c=>`ref-${c.id}` === aid), prop = d.props.find(c=>`ref-${c.id}` === aid), entity = c || l || prop;
      const a = assets.find(a=>a.id === aid);
      if (entity) add(reference(p,d,entity.id,chosen.get(entity.id) || row.refChoices?.[entity.id] || (c?'front':l?'view_n':'hero')));
      else if (a?.imageLibraryId) add({id:a.imageLibraryId});
      else if (a && imageURL(a.src).startsWith('data:')) add({dataUrl:a.src});
      if (refs.length === 3) break;
    }
    shot.assetId = ''; shot.firstFrame = ''; shot.lastFrame = '';
    view = {...p,assets,shots:[...p.shots.filter(s=>s.id !== id),shot]};
  }
  for (const dataUrl of d.slotRefs[key] || d.fuse[category] || []) add({dataUrl});
  if (refs.length > 3) throw Error('自动参考与额外参考合计最多3张，请减少额外参考');
  for (const r of refs) if (r.dataUrl?.length > 1048700) throw Error('参考图请压缩到768KB以内');
  view={...view,settings:{...view.settings,storyStyle:[view.settings.storyStyle,d.episodeStyles?.[canonical.episode]].filter(Boolean).join('；')}};
  const made = buildWorkflowPrompt(view,canonical,slot,{style:d.look,portraitStyle:{...(d.grades[id] || {}),...Object.fromEntries(Object.entries(d.slotGrades[key] || {}).filter(([,v])=>v))},aspect:episodeAspectOf(d),forceAspect:d.forceChar,referenceCount:refs.length});
  return {name:`${canonical.name} · ${IMAGE_SLOTS[category].find(s=>s.id === slot).label}`.slice(0,120),kind:{characters:'角色',locations:'场景',props:'道具',storyboard:'分镜'}[category],prompt:made.prompt,ratio:made.aspect,resolution:d.resolution,references:refs,metadata:{entityId:id,entityName:canonical.name.slice(0,160),slot,episode:canonical.episode.slice(0,64)}};
}
