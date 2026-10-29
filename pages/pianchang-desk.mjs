// 片场工作台：导入剧本 → 拆解 → 人物三视图/八表情 → 场景五向 → 道具主图 → 连续分镜。
// 选项与片场同一套：画幅、分辨率、出图风格、镜头语言、过肩正反打。
import {breakScript} from './pianchang-parse.mjs?v=1947fa3905e1';
import {readScript} from './script-breakdown.mjs?v=1947fa3905e1';
import {LOOK_STYLES} from './image-workflow.mjs?v=1947fa3905e1';
import * as L from './shot-language.mjs?v=1947fa3905e1';

const E = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
const ASPECTS = [{id:'1:1',label:'1:1'},{id:'3:4',label:'3:4'},{id:'16:9',label:'16:9'},{id:'9:16',label:'9:16'}];
const RESOLUTIONS = [{id:'1k',label:'1K'},{id:'2k',label:'2K'}];
const VIEWS = [{kind:'front',label:'正面',aspect:'3:4'},{kind:'side',label:'侧面',aspect:'3:4'},{kind:'back',label:'背面',aspect:'3:4'}];
const EXPRS = [{kind:'expr_smile',label:'微笑',aspect:'1:1'},{kind:'expr_anger',label:'愤怒',aspect:'1:1'},{kind:'expr_stern',label:'严肃',aspect:'1:1'},{kind:'expr_cry',label:'哭泣',aspect:'1:1'},{kind:'expr_sad',label:'悲伤',aspect:'1:1'},{kind:'expr_fear',label:'恐惧',aspect:'1:1'},{kind:'expr_provoke',label:'挑衅',aspect:'1:1'},{kind:'expr_stare',label:'凝视',aspect:'1:1'}];
const LOC_SLOTS = [
  {kind:'view_n',label:'1 北机位 · 从北往南拍',aspect:'16:9'},
  {kind:'view_w',label:'2 西机位 · 从西往东拍',aspect:'16:9'},
  {kind:'view_e',label:'3 东机位 · 从东往西拍',aspect:'16:9'},
  {kind:'view_s',label:'4 南机位 · 从南往北拍',aspect:'16:9'},
  {kind:'plan',label:'俯视白膜 · 鸟瞰',aspect:'1:1'},
];
const TABS = [
  {id:'script',label:'剧本',page:'script'},
  {id:'breakdown',label:'拆解',page:'script'},
  {id:'characters',label:'人物',page:'image'},
  {id:'locations',label:'场景',page:'image'},
  {id:'props',label:'道具',page:'image'},
  {id:'storyboard',label:'连续分镜',page:'shots'},
];
const PAGE_TABS = {script:['script','breakdown'],image:['characters','locations','props'],shots:['storyboard']};
const GRADES = [
  {key:'blend',label:'人景融合',options:[['','保持设定'],['align','轻度对齐'],['natural','自然融合'],['deep','深度融合']]},
  {key:'light',label:'光影融合',options:[['','保持设定'],['fill','柔和补光'],['mood','氛围强化'],['match','自然匹配']]},
  {key:'skin',label:'皮肤 / 肤色',options:[['','保持设定'],['clear','清透修饰'],['natural','自然肤质'],['pores','真实肌理']]},
  {key:'grain',label:'纹理',options:[['','保持设定'],['soft','柔和纹理'],['natural','自然纹理'],['film','颗粒质感']]},
  {key:'sharp',label:'锐度',options:[['','保持设定'],['soft','柔焦'],['standard','标准清晰'],['crisp','高清锐化']]},
];
const SAMPLE = `《夜渡》

第一场  外景  黄浦江边  夜

细雨。江面被对岸霓虹撕成碎金。LIN（28岁，深色风衣，短发）靠在锈蚀栏杆上，手里转着一枚缺角的铜钥匙。

第二场  内景  老轮渡候船室  夜

日光灯坏了一半。售票窗后，老周（六十出头，深蓝制服，金丝眼镜）把一碗热姜茶推过来。柜台上放着一只还在走的旧怀表。

老周
船误点了。钥匙还在你那儿？

LIN
在。它开的不是门。

第三场  外景  轮渡甲板  夜

雾气压低。LIN走到船头，风掀起她的风衣下摆。对岸那栋未完工大楼的顶层，唯一的窗户亮着。

LIN（轻声）
这一次，我先到。
`;

const opt = (list, value, allowEmpty = false) =>
  `${allowEmpty ? `<option value="" ${value ? '' : 'selected'}>无</option>` : ''}${list.map(o => `<option value="${E(o.id)}" ${o.id === value ? 'selected' : ''}>${E(o.label || o.id)}</option>`).join('')}`;

function fresh() {
  return {v:1, tab:'script', aspect:'16:9', resolution:'1k', look:'cinematic', forceChar:false, scope:'all', characters:[], locations:[], props:[], beats:[], stills:{}, history:{}, grades:{}, fuse:[]};
}

export function createPianchangDesk({getProject, change, toast, goto, uid, save}) {
  let host = null, pageKind = 'script', epoch = 0, busyKey = '', queue = null, picker = null;
  const alive = token => token === epoch && host?.isConnected;
  function d() {
    const p = getProject();
    if (!p.pianchang || p.pianchang.v !== 1) p.pianchang = fresh();
    p.pianchang.stills ||= {};
    p.pianchang.history ||= {};
    p.pianchang.grades ||= {};
    p.pianchang.fuse ||= [];
    return p.pianchang;
  }
  function unmount() { epoch++; host = null; picker = null; }
  function mount(el, kind) {
    unmount();
    epoch++;
    host = el;
    pageKind = kind;
    const tab = d().tab;
    if (!PAGE_TABS[kind].includes(tab)) d().tab = PAGE_TABS[kind][0];
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    paint();
  }
  function paint() {
    if (!host) return;
    const scroller = host.closest('.content') || document.scrollingElement;
    const y = scroller?.scrollTop || 0;
    const p = getProject();
    const desk = d();
    const tab = desk.tab;
    host.innerHTML = `<div class="pc-desk">${shell(p, desk, tab)}${picker ? pop(picker) : ''}</div>`;
    if (scroller) scroller.scrollTop = y;
  }
  function shell(p, desk, tab) {
    const showRail = tab !== 'script' && tab !== 'breakdown';
    return `<div class="pc-head"><p class="pc-kicker">剧爆棚 · 分镜参考图</p><h1 class="pc-title">${E(p.title || '未命名')}</h1><p class="pc-sub">${E(tabHint(tab))}</p></div>
      ${queue ? `<div class="pc-queue"><span>正在出 ${E(queue.label)}${queue.left ? ` · 还剩 ${queue.left}` : ''}</span><button type="button" data-pc="cancel">取消</button></div>` : ''}
      <div class="pc-tabs">${TABS.map(t => `<button type="button" data-pc="tab" data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}">${t.label}</button>`).join('')}</div>
      <div class="pc-layout ${showRail ? '' : 'pc-solo'}">${showRail ? rail(desk) : ''}<div class="pc-main">${body(p, desk, tab)}</div></div>`;
  }
  function tabHint(tab) {
    return {script:'可贴一整部。用「第1集 / 第2集」分开。拆解只更新条目，不会清掉已经出过的图。', breakdown:'拆开之后按人物、场景、道具和分镜分开看。出图去对应页。', characters:'正面、侧面、背面，再加八种表情。同一张主参考锁住脸和服装。', locations:'中间白膜是鸟瞰。先出白膜，再出北机位；西、东参考北机位和白膜；南机位补背面。', props:'先看材质、磨损、谁在用，再出道具主图。', storyboard:'每张图钉着剧本原文。写下到下一张的间隔。过肩镜头分开出正打和反打。'}[tab] || '';
  }
  function rail(desk) {
    return `<aside class="pc-rail"><div><p class="pc-kicker">画幅</p><div class="pc-pills">${ASPECTS.map(a => `<button type="button" data-pc="aspect" data-id="${a.id}" class="${desk.aspect === a.id ? 'on' : ''}">${a.label}</button>`).join('')}</div><label class="pc-check"><input type="checkbox" data-pc-field="forceChar" ${desk.forceChar ? 'checked' : ''}>强制人物画幅</label></div><div><p class="pc-kicker">分辨率</p><div class="pc-pills">${RESOLUTIONS.map(r => `<button type="button" data-pc="resolution" data-id="${r.id}" class="${desk.resolution === r.id ? 'on' : ''}">${r.label}</button>`).join('')}</div></div><div><p class="pc-kicker">出图风格</p><div class="pc-pills">${LOOK_STYLES.map(s => `<button type="button" data-pc="look" data-id="${E(s.id)}" class="${desk.look === s.id ? 'on' : ''}" title="${E(s.hint || '')}">${E(s.label)}</button>`).join('')}</div></div><div><p class="pc-kicker">资产范围</p><div class="pc-pills">${[['all','全部'],['series','全剧'],['episode','本集']].map(([id,label]) => `<button type="button" data-pc="scope" data-id="${id}" class="${desk.scope === id ? 'on' : ''}">${label}</button>`).join('')}</div></div></aside>`;
  }
  function body(p, desk, tab) {
    if (tab === 'script') return scriptPane(p);
    if (tab === 'breakdown') return breakdownPane(desk);
    if (tab === 'characters') return charactersPane(desk);
    if (tab === 'locations') return locationsPane(desk);
    if (tab === 'props') return propsPane(desk);
    return storyPane(desk);
  }
  function batchBar(label, hint, act, disabled) {
    return `<div class="pc-batch"><div><strong>${label}</strong><p>${hint}</p></div><button type="button" class="pc-go" data-pc="${act}" ${disabled || queue ? 'disabled' : ''}>${queue ? '出图中' : label}</button></div>`;
  }
  function scriptPane(p) {
    return `${batchBar('拆解本集', '只更新条目，不会清掉已经出过的图。', 'parse', !p.script?.trim())}
      <div class="pc-card"><div class="pc-row"><p class="pc-kicker">本集剧本 · 可粘贴或导入</p><div class="pc-row"><button type="button" data-pc="import">导入文件</button><button type="button" data-pc="sample">填入《夜渡》示例</button></div></div>
      <input type="file" data-pc-file accept=".txt,.md,.docx,text/plain" hidden>
      <textarea class="pc-script" data-pc-field="script" placeholder="场次、动作、对白……">${E(p.script || '')}</textarea></div>
      <div class="pc-card"><p class="pc-kicker">视觉风格 · 新建时选定，出图沿用</p><div class="pc-styles">${LOOK_STYLES.map(s => `<button type="button" data-pc="look" data-id="${E(s.id)}" class="${d().look === s.id ? 'on' : ''}"><b>${E(s.label)}</b><small>${E(s.hint || '')}</small></button>`).join('')}</div></div>`;
  }
  function shown(list) {
    const scope = d().scope;
    return list.filter(item => scope === 'all' || item.scope === scope);
  }
  function breakdownPane(desk) {
    const chars = shown(desk.characters), locs = shown(desk.locations), props = shown(desk.props);
    const block = (title, tab, rows, empty, render) => `<section class="pc-card"><div class="pc-row"><h2>${title} ${rows.length}</h2><button type="button" data-pc="tab" data-tab="${tab}">去出图</button></div><ul class="pc-list">${rows.map(render).join('') || `<li class="pc-empty">${empty}</li>`}</ul></section>`;
    return `<p class="pc-muted">${desk.characters.length || desk.beats.length ? '拆开了。出图去对应页。' : '先拆解本集。'}</p>
      ${block('人物', 'characters', chars, '先拆解本集', c => `<li><b>${E(c.name)}</b> <small>${E([c.role, c.age, c.gender].filter(Boolean).join(' · '))}</small><p>${E(c.appearance || '外貌待补')}</p>${c.costume ? `<p>服装：${E(c.costume)}</p>` : ''}</li>`)}
      ${block('场景', 'locations', locs, '先拆解本集', l => `<li><b>${E(l.name)}</b><p class="pc-muted">${E(l.heading || '')}</p><p>${E(l.description || '空间待补')}</p></li>`)}
      ${block('道具', 'props', props, '本集没有单独列出的关键道具', p => `<li><b>${E(p.name)}</b> <small>${E(p.category || '道具')}</small><p>${E(p.description || '用途待补')}${p.used_by ? ` · ${E(p.used_by)}` : ''}</p></li>`)}
      ${block('连续分镜', 'storyboard', desk.beats, '先拆解本集', b => `<li><p class="pc-mono">#${String(b.seq).padStart(2,'0')} · ${E(b.shot_size || b.shot_type || '')} · ${E(b.duration_sec)}s</p><b>${E(b.scene_heading || '分镜')}</b><p>${E(b.action || b.dialogue || '')}</p></li>`)}`;
  }
  function scopeBtn(kind, item) {
    return `<button type="button" data-pc="flip" data-kind="${kind}" data-id="${E(item.id)}">${item.scope === 'series' ? '收回本集' : '设为通用'}</button>`;
  }
  function still(entityId, kind, label, aspect) {
    const key = `${entityId}:${kind}`;
    const src = d().stills[key];
    const ratio = (d().forceChar && kind.startsWith('expr') || d().forceChar && ['front','side','back'].includes(kind) ? d().aspect : aspect).replace(':',' / ');
    const busy = busyKey === key;
    return `<figure class="pc-still" style="aspect-ratio:${ratio}"><div class="pc-frame">${src ? `<img src="${src}" alt="${E(label)}">` : `<span>${busy ? '正在出…' : '待出'}</span>`}</div><figcaption>${E(label)}</figcaption><div class="pc-still-actions"><button type="button" data-pc="one" data-batch="${batchOf(kind)}" data-id="${E(entityId)}" data-kind="${E(kind)}" ${queue && busyKey !== key ? 'disabled' : ''}>${busy ? '取消' : src ? '重出' : '出这张'}</button>${src ? `<button type="button" data-pc="drop" data-id="${E(entityId)}" data-kind="${E(kind)}">删除</button>` : ''}</div></figure>`;
  }
  function batchOf(kind) {
    if (kind === 'hero') return 'props';
    if (kind === 'frame' || kind === 'reverse') return 'storyboard';
    if (kind === 'plan' || kind.startsWith('view_')) return 'locations';
    return 'characters';
  }
  function charactersPane(desk) {
    const list = shown(desk.characters);
    return `${batchBar('出本集人物', '点一次排队出完所有空位（正面、侧面、背面 + 八张表情）。已有的图不会覆盖。', 'batch-characters', !list.length)}
      <button type="button" class="pc-ghost" data-pc="add-char" ${queue ? 'disabled' : ''}>增加人物</button>
      <ol class="pc-stack">${list.map(c => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="characters" data-id="${E(c.id)}" data-key="name" value="${E(c.name)}"><small class="pc-chip">${c.scope === 'series' ? '全剧' : '本集'}</small><p class="pc-muted">${E(c.role)} · ${E(c.age)} · ${E(c.gender)}</p></div><div class="pc-row">${scopeBtn('characters', c)}<button type="button" data-pc="batch-one" data-batch="characters" data-id="${E(c.id)}">${queue?.entityId === c.id ? '取消' : '出这个人'}</button><button type="button" data-pc="del-char" data-id="${E(c.id)}">删除</button></div></div>
        <div class="pc-bio"><p class="pc-kicker">小传提示词 · 出图会用到</p><div class="pc-grid3"><label>身份<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="role" value="${E(c.role || '')}"></label><label>年龄<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="age" value="${E(c.age || '')}"></label><label>性别<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="gender" value="${E(c.gender || '')}"></label></div><label>外貌<textarea data-pc-entity="characters" data-id="${E(c.id)}" data-key="appearance" rows="3">${E(c.appearance || '')}</textarea></label><label>服装<textarea data-pc-entity="characters" data-id="${E(c.id)}" data-key="costume" rows="2">${E(c.costume || '')}</textarea></label>${gradeBox(c.id)}</div>
        <p class="pc-kicker">三视图 · 各一张</p><div class="pc-grid3">${VIEWS.map(v => still(c.id, v.kind, v.label, v.aspect)).join('')}</div>
        <p class="pc-kicker">八种表情 · 单人面部特写</p><div class="pc-grid8">${EXPRS.map(v => still(c.id, v.kind, v.label, v.aspect)).join('')}</div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现人物，也可以点上面的增加人物。</p>'}${fuseBox()}`;
  }
  function gradeBox(id) {
    const g = d().grades[id] || {};
    return `<details class="pc-grade"><summary>人物质感与表演</summary><div class="pc-grid3">${GRADES.map(group => `<label>${group.label}<select data-pc-grade="${group.key}" data-id="${E(id)}">${group.options.map(([v, label]) => `<option value="${v}" ${g[group.key] === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`).join('')}</div></details>`;
  }
  function locationsPane(desk) {
    const list = shown(desk.locations);
    return `${batchBar('出本集场景', '中间白膜是鸟瞰。先出白膜，再出北机位；左右参考北机位和白膜；南机位再根据左右补背面。', 'batch-locations', !list.length)}
      <ol class="pc-stack">${list.map(l => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="locations" data-id="${E(l.id)}" data-key="name" value="${E(l.name)}"><small class="pc-chip">${l.scope === 'series' ? '全剧' : '本集'}</small><p class="pc-muted">${E(l.heading || '')}</p><p>${E(l.description || '')}</p><p class="pc-kicker">俯视：上北下南 · 左西右东。先出俯视白膜，四向只从这张图的四边拍。</p></div><div class="pc-row">${scopeBtn('locations', l)}<button type="button" data-pc="batch-one" data-batch="locations" data-id="${E(l.id)}">${queue?.entityId === l.id ? '取消' : '出这个场景'}</button></div></div>
        <div class="pc-picks">${pick('locations', l.id, 'shot_size', '景别', L.SHOT_SIZES, l.shot_size || '全景')}${pick('locations', l.id, 'composition', '机位', L.ANGLES, l.composition || '眼睛平视')}${pick('locations', l.id, 'camera_move', '运镜', L.CAMERA_MOVES, l.camera_move || '固定镜头')}${pick('locations', l.id, 'lighting', '光影', L.LIGHTINGS, l.lighting || '自然光')}</div>
        <div class="pc-cross"><span></span>${still(l.id,'view_n','北机位', slotAspect('locations','view_n'))}<span></span>${still(l.id,'view_w','西机位', slotAspect('locations','view_w'))}${still(l.id,'plan','俯视白膜','1:1')}${still(l.id,'view_e','东机位', slotAspect('locations','view_e'))}<span></span>${still(l.id,'view_s','南机位', slotAspect('locations','view_s'))}<span></span></div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现场景。</p>'}${fuseBox()}`;
  }
  function propsPane(desk) {
    const list = shown(desk.props);
    return `${batchBar('出本集道具', '点一次排队出完所有空位。已有的图不会覆盖。', 'batch-props', !list.length)}
      <ol class="pc-stack">${list.map(item => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="props" data-id="${E(item.id)}" data-key="name" value="${E(item.name)}"><small class="pc-chip">${item.scope === 'series' ? '全剧' : '本集'}</small><p>${E(item.description || '')}</p></div>${scopeBtn('props', item)}</div><div class="pc-prop">${still(item.id,'hero','道具主图','1:1')}</div>
        <div class="pc-grid3"><label>材质 / 磨损<textarea data-pc-entity="props" data-id="${E(item.id)}" data-key="material" rows="2">${E(item.material || '')}</textarea></label><label>谁在用<input data-pc-entity="props" data-id="${E(item.id)}" data-key="used_by" value="${E(item.used_by || '')}"></label><label>叙事功能<textarea data-pc-entity="props" data-id="${E(item.id)}" data-key="significance" rows="2">${E(item.significance || '')}</textarea></label></div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现道具。</p>'}${fuseBox()}`;
  }
  function storyPane(desk) {
    return `${batchBar('按参考出本集分镜', '点一次排队出完所有空位。过肩可一次出正反打。已有的图不会覆盖。', 'batch-storyboard', !desk.beats.length)}
      <ol class="pc-stack">${desk.beats.map((b, i) => beatCard(desk, b, desk.beats[i + 1])).join('')}</ol>
      <button type="button" class="pc-ghost" data-pc="add-beat">插入一段</button>
      ${desk.beats.length ? '' : '<p class="pc-empty">拆解后出现连续分镜。</p>'}${fuseBox()}`;
  }
  function beatCard(desk, b, next) {
    const ots = (b.composition || '') === '过肩镜头';
    const from = desk.characters.find(c => c.id === b.ots_from)?.name;
    const to = desk.characters.find(c => c.id === b.ots_to)?.name;
    return `<li class="pc-card pc-beat"><div>${still(b.id,'frame', ots && from && to ? `正打 · 过${from}肩拍${to}` : '分镜', slotAspect('storyboard','frame'))}${ots ? still(b.id,'reverse', from && to ? `反打 · 过${to}肩拍${from}` : '反打', slotAspect('storyboard','reverse')) + `<button type="button" class="pc-go" data-pc="pair" data-id="${E(b.id)}" ${!b.ots_from || !b.ots_to ? 'disabled' : ''}>一次出正反打</button>` : ''}</div>
      <div><div class="pc-times"><label>开始<input type="number" min="0" step="0.5" data-pc-beat="${E(b.id)}" data-key="start_sec" value="${Number(b.start_sec) || 0}"> <small>${fmt(b.start_sec)}</small></label><label>镜长<input type="number" min="0.5" max="15" step="0.5" data-pc-beat="${E(b.id)}" data-key="duration_sec" value="${Number(b.duration_sec) || 4}"><small>s</small></label>${next ? `<label>到下一张<input type="number" min="0" step="0.5" data-pc-beat="${E(b.id)}" data-key="next_gap_sec" value="${Number(b.next_gap_sec) || 0}"><small>s</small></label>` : '<span>终镜</span>'}</div>
        <input class="pc-name" data-pc-beat="${E(b.id)}" data-key="scene_heading" value="${E(b.scene_heading || '分镜')}">
        <p>${E(b.action || '')}</p>${b.dialogue ? `<p class="pc-line">${E(b.dialogue)}</p>` : ''}${b.script_excerpt ? `<button type="button" class="pc-excerpt" data-pc="cite" data-id="${E(b.id)}">原文 · ${E(b.script_excerpt.slice(0, 80))}</button>` : ''}
        <div class="pc-picks">${pick('beats', b.id, 'shot_size', '景别', L.SHOT_SIZES, b.shot_size || b.shot_type || '中景')}${pick('beats', b.id, 'composition', '机位', L.ANGLES, b.composition || '眼睛平视')}${pick('beats', b.id, 'framing', '构图', L.COMPOSITIONS, b.framing || '三分构图')}${pick('beats', b.id, 'camera_move', '运镜', L.CAMERA_MOVES, b.camera_move || '固定镜头')}${pick('beats', b.id, 'stylize', '风格化', L.STYLIZES, b.stylize || '电影叙事')}${pick('beats', b.id, 'lighting', '光影', L.LIGHTINGS, b.lighting || '电影级布光')}${pick('beats', b.id, 'technique', '特殊摄影', L.TECHNIQUES, b.technique || '', true)}</div>
        ${ots ? `<div class="pc-grid2"><label>过谁的肩<select data-pc-beat="${E(b.id)}" data-key="ots_from">${desk.characters.map(c => `<option value="${E(c.id)}" ${b.ots_from === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label><label>拍谁的脸<select data-pc-beat="${E(b.id)}" data-key="ots_to">${desk.characters.map(c => `<option value="${E(c.id)}" ${b.ots_to === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label></div>` : ''}
        <label>站位与视线<textarea data-pc-beat="${E(b.id)}" data-key="ots_block" rows="2" placeholder="保持视线轴，不越轴">${E(b.ots_block || '')}</textarea></label>
      </div></li>`;
  }
  function pick(list, id, key, label, options, value, allowEmpty = false) {
    return `<label class="pc-pick"><span>${label}</span><select data-pc-entity="${list}" data-id="${E(id)}" data-key="${key}">${opt(options, value, allowEmpty)}</select></label>`;
  }
  function fuseBox() {
    const n = (d().fuse || []).length;
    return `<div class="pc-card"><p class="pc-kicker">额外参考 · 最多 3 张，出这一页时融进去</p><input type="file" data-pc-fuse accept="image/png,image/jpeg,image/webp" multiple><p class="pc-muted">已选 ${n} 张</p></div>`;
  }
  function pop(state) {
    return `<div class="pc-pop"><div class="pc-pop-card"><div class="pc-row"><b>${E(state.label)}</b><button type="button" data-pc="pop-close">关闭</button></div><div class="pc-pop-grid">${state.options.map(o => `<button type="button" data-pc="pop-pick" data-id="${E(o.id)}" class="${o.id === state.value ? 'on' : ''}">${E(o.label || o.id || '无')}</button>`).join('')}</div></div></div>`;
  }
  function fmt(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  function slotAspect(batch, kind) {
    const desk = d();
    if (batch === 'characters') {
      if (desk.forceChar) return desk.aspect;
      return EXPRS.some(x => x.kind === kind) ? '1:1' : '3:4';
    }
    if (kind === 'plan' || kind === 'hero') return '1:1';
    return desk.aspect || '16:9';
  }
  function look() { return LOOK_STYLES.find(s => s.id === d().look) || LOOK_STYLES[0]; }
  function promptFor(batch, entity, kind) {
    const style = look();
    const aspect = slotAspect(batch, kind);
    const grade = d().grades[entity.id] || {};
    const gradeText = Object.entries(grade).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(', ');
    if (batch === 'characters') {
      const slot = [...VIEWS, ...EXPRS].find(s => s.kind === kind);
      return [`${style.prompt}`, `Character reference plate, ${slot?.label || kind}, ${kind.startsWith('expr') ? 'single face close-up' : 'full body turnaround'}.`, `Name ${entity.name}. Role ${entity.role || ''}. Age ${entity.age || ''}. Gender ${entity.gender || ''}.`, `Appearance: ${entity.appearance || 'as written'}. Costume: ${entity.costume || 'as written'}.`, gradeText && `Grade ${gradeText}.`, `Frame ${aspect}. No text, no watermark.`].filter(Boolean).join('\n');
    }
    if (batch === 'locations') {
      const slot = LOC_SLOTS.find(s => s.kind === kind);
      return [`${style.prompt}`, kind === 'plan' ? 'Orthographic bird-eye white massing model of the room, north up.' : `Standing camera: ${slot?.label || kind}. Same room, same time, same weather.`, `Place ${entity.name}. ${entity.heading || ''} ${entity.description || ''}`, `Shot ${entity.shot_size || '全景'}, angle ${entity.composition || '眼睛平视'}, move ${entity.camera_move || '固定镜头'}, light ${entity.lighting || '自然光'}.`, `Frame ${aspect}. No people, no text.`].join('\n');
    }
    if (batch === 'props') {
      return [`${style.prompt}`, `Single prop hero still on a neutral ground.`, `${entity.name}. Material ${entity.material || ''}. Used by ${entity.used_by || ''}. ${entity.description || ''} ${entity.significance || ''}`, `Square 1:1. No text.`].join('\n');
    }
    const side = kind === 'reverse' ? 'reverse over-the-shoulder' : 'master shot';
    return [`${style.prompt}`, `${side}.`, `Scene ${entity.scene_heading || ''}. Action ${entity.action || ''}. Dialogue ${entity.dialogue || ''}.`, `Size ${entity.shot_size || entity.shot_type || '中景'}. Angle ${entity.composition || ''}. Framing ${entity.framing || ''}. Move ${entity.camera_move || ''}. Stylize ${entity.stylize || ''}. Light ${entity.lighting || ''}. Technique ${entity.technique || ''}.`, entity.ots_block && `Blocking ${entity.ots_block}.`, entity.script_excerpt && `Script: ${entity.script_excerpt}`, `Frame ${aspect}. No subtitles, no watermark.`].filter(Boolean).join('\n');
  }
  function entityOf(batch, id) {
    const desk = d();
    if (batch === 'characters') return desk.characters.find(x => x.id === id);
    if (batch === 'locations') return desk.locations.find(x => x.id === id);
    if (batch === 'props') return desk.props.find(x => x.id === id);
    return desk.beats.find(x => x.id === id);
  }
  function jobsFor(batch, onlyId) {
    const desk = d();
    const list = (batch === 'characters' ? shown(desk.characters) : batch === 'locations' ? shown(desk.locations) : batch === 'props' ? shown(desk.props) : desk.beats).filter(item => !onlyId || item.id === onlyId);
    const kinds = batch === 'characters' ? [...VIEWS, ...EXPRS] : batch === 'locations' ? [{kind:'plan'}, {kind:'view_n'}, {kind:'view_w'}, {kind:'view_e'}, {kind:'view_s'}] : batch === 'props' ? [{kind:'hero'}] : null;
    const out = [];
    for (const item of list) {
      if (batch === 'storyboard') {
        if (!desk.stills[`${item.id}:frame`]) out.push({batch, id: item.id, kind: 'frame', label: item.scene_heading || '分镜'});
        if ((item.composition === '过肩镜头') && item.ots_from && item.ots_to && !desk.stills[`${item.id}:reverse`]) out.push({batch, id: item.id, kind: 'reverse', label: '反打'});
      } else {
        for (const k of kinds) if (!desk.stills[`${item.id}:${k.kind}`]) out.push({batch, id: item.id, kind: k.kind, label: item.name || k.kind});
      }
    }
    return out;
  }
  async function runJobs(jobs) {
    if (!jobs.length) { toast('空位都有图了'); return; }
    const token = epoch;
    queue = {left: jobs.length, label: '', entityId: jobs[0].id};
    for (const job of jobs) {
      if (!alive(token) || queue?.stop) break;
      queue.label = `${job.label} · ${job.kind}`;
      queue.left = jobs.length - jobs.indexOf(job);
      queue.entityId = job.id;
      paint();
      const ok = await runOne(job.batch, job.id, job.kind, token, true);
      if (!ok) break;
    }
    if (alive(token)) { queue = null; busyKey = ''; paint(); }
  }
  async function runOne(batch, id, kind, token = epoch, fromBatch = false) {
    const key = `${id}:${kind}`;
    if (!fromBatch && busyKey === key) { queue = queue ? {...queue, stop: true} : null; return false; }
    const entity = entityOf(batch, id);
    if (!entity) return false;
    busyKey = key;
    if (!fromBatch) paint();
    const refs = [...(d().fuse || [])];
    if (batch === 'characters' && kind !== 'front' && d().stills[`${id}:front`]) refs.unshift(d().stills[`${id}:front`]);
    if (batch === 'locations' && kind !== 'plan' && d().stills[`${id}:plan`]) refs.unshift(d().stills[`${id}:plan`]);
    try {
      const res = await fetch('/api/pianchang-still', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt: promptFor(batch, entity, kind), aspect: slotAspect(batch, kind), resolution: d().resolution === '1k' ? '1k' : '2k', refs: refs.filter(u => typeof u === 'string' && u.startsWith('data:')).slice(0, 3)})});
      const data = await res.json().catch(() => ({}));
      if (!alive(token)) return false;
      if (!res.ok || !data.dataUrl) throw Error(data.error || '出图失败');
      change(() => {
        const desk = d();
        if (desk.stills[key]) desk.history[key] = [...(desk.history[key] || []), desk.stills[key]].slice(-6);
        desk.stills[key] = data.dataUrl;
        if (batch === 'storyboard' && kind === 'frame') attachFrame(getProject(), entity, data.dataUrl);
      }, false);
      if (alive(token)) paint();
      return true;
    } catch (err) {
      if (alive(token)) toast(err.message === 'Failed to fetch' ? '出图服务还没接上' : err.message);
      return false;
    } finally {
      if (alive(token) && !fromBatch) { busyKey = ''; paint(); }
    }
  }
  function attachFrame(p, beat, src) {
    let id = beat.frameAssetId;
    if (!id || !p.assets.some(a => a.id === id)) {
      id = uid();
      p.assets.push({id, name: (beat.scene_heading || '分镜').slice(0, 40), type:'分镜', kind:'image', src, created: Date.now(), locked:false, tags:'', description: beat.action || ''});
      beat.frameAssetId = id;
    } else {
      const asset = p.assets.find(a => a.id === id);
      asset.src = src;
    }
    const shot = p.shots.find(s => s.id === beat.id);
    if (shot) shot.assetId = id;
  }
  function parse() {
    const p = getProject();
    if (!String(p.script || '').trim()) { toast('先把剧本贴进来'); return; }
    let parsed;
    try { parsed = breakScript(p.script); }
    catch (err) { toast(err.message || '拆解失败'); return; }
    change(() => {
      const desk = d();
      desk.characters = merge(desk.characters, parsed.characters, c => ({role:c.role || '角色', age:c.age || '', gender:c.gender || '', appearance:c.appearance || '', costume:c.costume || ''}));
      desk.locations = merge(desk.locations, parsed.locations, l => ({heading:l.heading || '', description:l.description || '', time_of_day:l.time_of_day || '', shot_size:'全景', composition:'眼睛平视', camera_move:'固定镜头', lighting:'自然光'}));
      desk.props = merge(desk.props, parsed.props, item => ({category:item.category || '道具', description:item.description || '', material:item.material || '', significance:item.significance || '', used_by:item.used_by || ''}));
      const oldBeats = desk.beats;
      let clock = 0;
      desk.beats = (parsed.beats || []).map((b, i) => {
        const prev = oldBeats.find(x => x.script_excerpt && x.script_excerpt === b.script_excerpt) || oldBeats[i];
        const dur = Math.min(15, Math.max(3, Number(b.duration_sec) || 4));
        const row = {id: prev?.id || uid(), seq: i + 1, episode: b.episode || '本集', scene_heading: b.scene_heading || '分镜', action: b.action || '', dialogue: b.dialogue || '', shot_type: b.shot_type || '中景', shot_size: prev?.shot_size || (b.shot_type === '过肩镜头' ? '中景' : b.shot_type) || '中景', composition: prev?.composition || (b.dialogue ? '过肩镜头' : '眼睛平视'), framing: prev?.framing || '三分构图', camera_move: prev?.camera_move || '固定镜头', stylize: prev?.stylize || '电影叙事', lighting: prev?.lighting || '电影级布光', technique: prev?.technique || '', start_sec: clock, duration_sec: dur, next_gap_sec: b.next_gap_sec ?? 0.5, script_excerpt: b.script_excerpt || '', ots_from: prev?.ots_from || '', ots_to: prev?.ots_to || '', ots_block: prev?.ots_block || '', frameAssetId: prev?.frameAssetId || ''};
        if (row.composition === '过肩镜头' && (!row.ots_from || !row.ots_to)) {
          const named = desk.characters.filter(c => `${row.action} ${row.dialogue}`.includes(c.name));
          row.ots_from = row.ots_from || named[0]?.id || desk.characters[0]?.id || '';
          row.ots_to = row.ots_to || named.find(c => c.id !== row.ots_from)?.id || desk.characters[1]?.id || '';
        }
        clock += dur + (Number(row.next_gap_sec) || 0);
        return row;
      });
      syncShots(p, desk);
      desk.tab = 'breakdown';
    });
    toast(`已拆开：人物 ${d().characters.length} · 场景 ${d().locations.length} · 道具 ${d().props.length} · 分镜 ${d().beats.length}`);
    if (pageKind !== 'script') goto('script');
    else paint();
  }
  function merge(old, incoming, extra) {
    return (incoming || []).map(item => {
      const prev = old.find(o => o.name === item.name);
      const next = {id: prev?.id || uid(), name: item.name, scope: prev?.scope || 'episode', ...extra(item)};
      if (!prev) return next;
      for (const [k, v] of Object.entries(extra(item))) if ((v === '' || v == null) && prev[k]) next[k] = prev[k];
      next.id = prev.id;
      next.scope = prev.scope || 'episode';
      return next;
    });
  }
  function syncShots(p, desk) {
    p.shots = desk.beats.map(b => ({id: b.id, episode: b.episode || '本集', scene: b.scene_heading || '分镜', description: (b.action || b.scene_heading || '分镜').slice(0, 2000), dialogue: b.dialogue || '', duration: Math.min(60, Math.max(0.5, Number(b.duration_sec) || 4)), nextGap: Number(b.next_gap_sec) || 0, size: b.shot_size || '中景', angle: b.composition || '眼睛平视', framing: b.framing || '', camera: b.camera_move || '固定镜头', stylize: b.stylize || '', lighting: b.lighting || '', technique: b.technique || '', sourceText: b.script_excerpt || '', subtitle: '', assetId: b.frameAssetId || '', otsFrom: b.ots_from || '', otsTo: b.ots_to || ''}));
  }
  function listOf(name) {
    const desk = d();
    if (name === 'characters') return desk.characters;
    if (name === 'locations') return desk.locations;
    if (name === 'props') return desk.props;
    return desk.beats;
  }
  function patchEntity(list, id, key, value) {
    change(() => {
      const row = listOf(list).find(x => x.id === id);
      if (!row) return;
      row[key] = value;
      if (list === 'beats' && key === 'composition' && value === '过肩镜头') {
        const named = d().characters.filter(c => `${row.action || ''} ${row.dialogue || ''}`.includes(c.name));
        row.ots_from = row.ots_from || named[0]?.id || d().characters[0]?.id || '';
        row.ots_to = row.ots_to || named.find(c => c.id !== row.ots_from)?.id || d().characters[1]?.id || '';
      }
      if (list === 'beats') syncShots(getProject(), d());
    });
  }
  function onInput(e) {
    const el = e.target;
    if (el.dataset.pcField === 'script') {
      getProject().script = el.value;
      save(() => {});
    }
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.pcField === 'forceChar') { change(() => { d().forceChar = el.checked; }); return; }
    if (el.dataset.pcGrade) { change(() => { const g = d().grades[el.dataset.id] ||= {}; g[el.dataset.pcGrade] = el.value; }); return; }
    if (el.dataset.pcEntity && el.dataset.id && el.dataset.key) { patchEntity(el.dataset.pcEntity, el.dataset.id, el.dataset.key, el.value); return; }
    if (el.dataset.pcBeat && el.dataset.key) {
      const key = el.dataset.key;
      const value = el.type === 'number' ? Number(el.value) : el.value;
      patchEntity('beats', el.dataset.pcBeat, key, key === 'duration_sec' ? Math.min(15, Math.max(0.5, value || 0.5)) : value);
      return;
    }
    if (el.hasAttribute('data-pc-fuse')) {
      const files = [...el.files].slice(0, 3);
      Promise.all(files.map(fileToData)).then(urls => { change(() => { d().fuse = urls.filter(Boolean).slice(0, 3); }); toast(`已放入 ${d().fuse.length} 张额外参考`); }).catch(err => toast(err.message));
    }
    if (el.hasAttribute('data-pc-file')) {
      const file = el.files?.[0];
      if (!file) return;
      readScript(file).then(text => { change(() => { getProject().script = text; }); toast(`已导入 ${file.name}`); }).catch(err => toast(err.message));
    }
  }
  function fileToData(file) {
    if (file.size > 2 * 1024 * 1024) throw Error('参考图请压到 2MB 以内');
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error('读不到这张图')); r.readAsDataURL(file); });
  }
  function onClick(e) {
    const btn = e.target.closest('[data-pc]');
    if (!btn || !host?.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.pc;
    if (act === 'tab') {
      const id = btn.dataset.tab;
      const dest = TABS.find(t => t.id === id)?.page;
      change(() => { d().tab = id; }, false);
      if (dest && dest !== pageKind) goto(dest);
      else paint();
      return;
    }
    if (act === 'aspect' || act === 'resolution' || act === 'look' || act === 'scope') {
      change(() => { d()[act === 'look' ? 'look' : act === 'scope' ? 'scope' : act] = btn.dataset.id; });
      return;
    }
    if (act === 'import') { host.querySelector('[data-pc-file]')?.click(); return; }
    if (act === 'sample') { change(() => { const p = getProject(); p.script = SAMPLE; if (!p.title || p.title === '未命名项目') p.title = '夜渡'; }); toast('已填入《夜渡》'); return; }
    if (act === 'parse') { parse(); return; }
    if (act === 'cancel') { if (queue) queue.stop = true; toast('正在取消，这一张出完就停'); return; }
    if (act === 'add-char') { change(() => { d().characters.push({id: uid(), name: '新人物', scope: 'episode', role: '角色', age: '', gender: '', appearance: '', costume: ''}); }); return; }
    if (act === 'del-char') {
      const id = btn.dataset.id;
      const name = d().characters.find(c => c.id === id)?.name || '这个人';
      if (!confirm(`确定删除人物「${name}」？这个人的拆分图会一起删。`)) return;
      change(() => {
        const desk = d();
        desk.characters = desk.characters.filter(c => c.id !== id);
        for (const key of Object.keys(desk.stills)) if (key.startsWith(id + ':')) delete desk.stills[key];
      });
      return;
    }
    if (act === 'flip') {
      change(() => { const row = listOf(btn.dataset.kind).find(x => x.id === btn.dataset.id); if (row) row.scope = row.scope === 'series' ? 'episode' : 'series'; });
      return;
    }
    if (act === 'add-beat') {
      change(() => {
        const desk = d();
        const last = desk.beats.at(-1);
        const start = last ? Number(last.start_sec) + Number(last.duration_sec) + Number(last.next_gap_sec || 0) : 0;
        desk.beats.push({id: uid(), seq: desk.beats.length + 1, scene_heading: '新分镜', action: '', dialogue: '', shot_size: '中景', composition: '眼睛平视', framing: '三分构图', camera_move: '固定镜头', stylize: '电影叙事', lighting: '电影级布光', technique: '', start_sec: start, duration_sec: 4, next_gap_sec: 0.5, script_excerpt: ''});
        syncShots(getProject(), desk);
      });
      return;
    }
    if (act === 'cite') {
      const beat = d().beats.find(b => b.id === btn.dataset.id);
      change(() => { d().tab = 'script'; }, false);
      if (pageKind !== 'script') goto('script');
      else paint();
      toast(beat?.script_excerpt ? '已回到剧本' : '这条没有钉原文');
      return;
    }
    if (act === 'drop') {
      if (!confirm('确定删除这张图？')) return;
      change(() => { delete d().stills[`${btn.dataset.id}:${btn.dataset.kind}`]; });
      return;
    }
    if (act === 'one') {
      const {batch, id, kind} = btn.dataset;
      if (busyKey === `${id}:${kind}`) { if (queue) queue.stop = true; return; }
      void runOne(batch, id, kind);
      return;
    }
    if (act === 'batch-characters' || act === 'batch-locations' || act === 'batch-props' || act === 'batch-storyboard') {
      const batch = act.replace('batch-', '');
      void runJobs(jobsFor(batch));
      return;
    }
    if (act === 'batch-one') { void runJobs(jobsFor(btn.dataset.batch, btn.dataset.id)); return; }
    if (act === 'pair') {
      const beat = d().beats.find(b => b.id === btn.dataset.id);
      if (!beat) return;
      const jobs = ['frame', 'reverse'].filter(kind => !d().stills[`${beat.id}:${kind}`]).map(kind => ({batch:'storyboard', id: beat.id, kind, label: kind === 'frame' ? '正打' : '反打'}));
      if (!jobs.length) { toast('正反打都有了'); return; }
      void runJobs(jobs);
      return;
    }
  }
  return {mount, unmount, parse};
}
