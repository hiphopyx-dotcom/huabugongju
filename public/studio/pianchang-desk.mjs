// 片场工作台：导入剧本 → 拆解 → 人物三视图/八表情 → 场景五向 → 道具主图 → 连续分镜。
// 选项与片场同一套：画幅、分辨率、出图风格、镜头语言、过肩正反打。
import {zipStore} from './script-docx.mjs';
import {readScript} from './script-breakdown.mjs';
import {LOOK_STYLES, PORTRAIT_STYLES, PORTRAIT_EMOTIONS, IMAGE_SLOTS} from './image-workflow.mjs';
import {imageRequest} from './image-workshop.mjs';
import {memberError} from './model-privacy.mjs';
import {resetQuota} from './quota.mjs';
import {removeReferences} from './asset-controls.mjs';
import * as Guide from './shot-guide.mjs';
import {escapeHTML as E, imageURL, contentURL, ensureDesk, scriptWindow, applyScriptDraft, episodeNames, visibleRows, syncShots as syncProjectShots, parseEpisode, entityFor, slotImage, acceptImage, prepareStill} from './pianchang-core.mjs';
import {POSES,axisBlock,axisDistance,dummySVG} from './pianchang-axis.mjs';
import * as L from './shot-language.mjs';
import {insertBeatAfter, insertSceneAfter, moveSceneBlock, moveBeat, sceneCode, dragEnabled, ORDER_UNSAVED} from './storyboard-edit.mjs';
import {episodeAspectOf, setEpisodeAspect} from './frame-aspect.mjs';

const ASPECTS = [{id:'1:1',label:'1:1'},{id:'3:4',label:'3:4'},{id:'16:9',label:'16:9'},{id:'9:16',label:'9:16'}];
const RESOLUTIONS = [{id:'1k',label:'1K'},{id:'2k',label:'2K'}];
const VIEWS = [{kind:'front',label:'正面',aspect:'3:4'},{kind:'side',label:'侧面',aspect:'3:4'},{kind:'back',label:'背面',aspect:'3:4'}];
const EXPRS = [{kind:'expr_smile',label:'微笑',aspect:'1:1'},{kind:'expr_anger',label:'愤怒',aspect:'1:1'},{kind:'expr_stern',label:'严肃',aspect:'1:1'},{kind:'expr_cry',label:'哭泣',aspect:'1:1'},{kind:'expr_sad',label:'悲伤',aspect:'1:1'},{kind:'expr_fear',label:'恐惧',aspect:'1:1'},{kind:'expr_provoke',label:'挑衅',aspect:'1:1'},{kind:'expr_stare',label:'凝视',aspect:'1:1'}];
const LOC_SLOTS = [
  {kind:'view_n',label:'1 北机位 · 从北往南拍',aspect:'16:9'},
  {kind:'view_w',label:'2 西机位 · 从西往东拍',aspect:'16:9'},
  {kind:'view_e',label:'3 东机位 · 从东往西拍',aspect:'16:9'},
  {kind:'view_s',label:'4 南机位 · 从南往北拍',aspect:'16:9'},
  {kind:'plan',label:'俯视白模 · 鸟瞰',aspect:'1:1'},
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

export function createPianchangDesk({getProject, getUser = () => null, change, toast, goto, uid, save, request = imageRequest, fetchImage = (...args) => fetch(...args), onGallery = () => {}}) {
  let host = null, pageKind = 'script', epoch = 0, busyKey = '', queue = null, picker = null, message = '', status = null, loading = false, library = [], historyView = null, preview = null, cite = '';
  const scope = () => `${getUser()?.id || 'guest'}:${getProject()?.id || ''}`;
  let mountedScope = '';
  const detailState = new Map();
  let dragging=null, storyQuery='', orderDrag=null;
  function onPointerDown(e){const actor=e.target.closest('[data-pc-actor]');if(!actor || queue || !current())return;e.preventDefault();dragging={actor,who:actor.dataset.pcActor,id:actor.dataset.beat,pointer:e.pointerId};actor.setPointerCapture?.(e.pointerId);}
  function onPointerMove(e){if(!dragging || !current())return;const b=d().beats.find(b=>b.id===dragging.id),board=dragging.actor.closest('.pc-axis-board');if(!b||!board)return;const r=board.getBoundingClientRect();if(!r.width||!r.height)return;const block=axisBlock(b.ots_block);block[dragging.who].along=Math.min(92,Math.max(8,(e.clientX-r.left)/r.width*100));block[dragging.who].off=Math.min(32,Math.max(-28,(e.clientY-r.top)/r.height*100-50));b.ots_block=JSON.stringify(block);dragging.actor.style.left=block[dragging.who].along+'%';dragging.actor.style.top=(50+block[dragging.who].off)+'%';const label=board.parentElement.querySelector('[data-pc-distance]');if(label)label.textContent='间距约 '+axisDistance(block)+' 米';}
  function onPointerUp(){if(!dragging)return;dragging=null;commit(()=>syncShots(getProject(),d()));}
  function searchingNow(){return !dragEnabled(storyQuery)}
  function onDragStart(e){const handle=e.target.closest('[data-pc="drag-scene"],[data-pc="drag-beat"]');if(!handle||handle.disabled||searchingNow()||queue){e.preventDefault();return}orderDrag={kind:handle.dataset.pc,id:handle.dataset.scene||handle.dataset.id};e.dataTransfer?.setData('text/plain',orderDrag.kind+':'+orderDrag.id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move'}
  function onDragOver(e){if(!orderDrag||searchingNow())return;const zone=e.target.closest('[data-scene],[data-pc="drag-beat"]');if(!zone)return;e.preventDefault()}
  function onDrop(e){const drag=orderDrag;orderDrag=null;if(!drag||searchingNow())return;e.preventDefault();const scene=e.target.closest('[data-scene]')?.dataset.scene;const beat=e.target.closest('[data-pc="drag-beat"],.pc-beat')?.dataset.id||e.target.closest('[data-id]')?.dataset.id;try{commit(()=>{const desk=d();if(drag.kind==='drag-scene'){if(!scene)throw Error(ORDER_UNSAVED);desk.beats=moveSceneBlock(desk.beats,desk.episode,drag.id,scene)}else{const target=e.target.closest('[data-pc="drag-beat"]')?.dataset.id;if(!target)throw Error(ORDER_UNSAVED);desk.beats=moveBeat(desk.beats,desk.episode,drag.id,target)}syncShots(getProject(),desk)})}catch(err){toast(ORDER_UNSAVED);message=ORDER_UNSAVED;paint()}void beat}

  let cachedProject = null, cachedDesk = null;
  const capture = () => ({epoch,scope:scope()});
  const alive = token => token.epoch === epoch && token.scope === scope() && mountedScope === scope() && host?.isConnected;
  const current = () => mountedScope === scope() && !!host?.isConnected;
  const d = () => {const p=getProject();if(cachedProject!==p || cachedDesk!==p.pianchang){cachedProject=p;cachedDesk=ensureDesk(p,uid)}return cachedDesk};
  const commit = fn => { change(fn,false); cachedProject=null; paint(); };
  const error = e => { message = memberError(e?.message || '操作未完成'); toast(message); paint(); };
  function unmount() {
    epoch++; dragging=null;
    if (queue) queue.stop = true;
    queue = null; busyKey = ''; picker = null; preview = null; historyView = null;
    if (host) { host.removeEventListener('click',onClick); host.removeEventListener('change',onChange); host.removeEventListener('input',onInput); host.removeEventListener('pointerdown',onPointerDown);host.removeEventListener('pointermove',onPointerMove);host.removeEventListener('pointerup',onPointerUp);host.removeEventListener('pointercancel',onPointerUp); host.removeEventListener('dragstart',onDragStart); host.removeEventListener('dragover',onDragOver); host.removeEventListener('drop',onDrop); }
    host = null;
  }
  function mount(el, kind) {
    unmount(); cachedProject=null; if(mountedScope !== scope())detailState.clear(); host = el; pageKind = kind; mountedScope = scope();
    message = ''; status = null; loading = false; library = [];
    if (!PAGE_TABS[kind]?.includes(d().tab)) d().tab = PAGE_TABS[kind]?.[0] || 'script';
    host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.addEventListener('input', onInput);host.addEventListener('pointerdown',onPointerDown);host.addEventListener('pointermove',onPointerMove);host.addEventListener('pointerup',onPointerUp);host.addEventListener('pointercancel',onPointerUp);host.addEventListener('dragstart',onDragStart);host.addEventListener('dragover',onDragOver);host.addEventListener('drop',onDrop);
    paint(); void refresh();
  }
  async function refresh() {
    if (!getUser() || !current() || loading) return;
    const token = capture(), projectId = getProject().id;
    loading = true;
    try {
      const [st,slots,workspace] = await Promise.all([request('status'),request('slots',null,{projectId}),request('workspace',null,{projectId})]);
      if (!alive(token)) return;
      status = st; library = slots.items || [];
      commit(() => {
        const p = getProject();
        if (!p.pianchang.cloudImported && workspace.workspace) {
          const old = p.imageWorkspace?.entities || [];
          p.imageWorkspace = {...workspace.workspace,entities:[...old,...(workspace.workspace.entities || []).filter(e=>!old.some(x=>x.id===e.id))]};
          p.pianchang.cloudImported = true;
        }
        cachedProject=null;
        const desk = d();
        for (const item of library) {
          const category = batchOf(item.metadata?.slot || '');
          const entity = (category === 'storyboard' ? desk.beats : desk[category]).find(e=>e.id === item.metadata?.entityId || e.aliases?.includes(item.metadata?.entityId));
          if (!entity) continue;
          const key = `${entity.id}:${item.metadata?.slot}`;
          // A selected older version stays selected. Newly resolved requests may fill it.
          const pending = desk.pending[key];
          const job = (st.jobs || []).find(j=>j.requestId === pending?.id);
          if (!desk.images[key] || pending && job?.status === 'done') acceptImage(getProject(),desk,key,item);
        }
        for (const [key,pending] of Object.entries(desk.pending)) {
          const job = (st.jobs || []).find(j=>j.requestId === pending.id);
          if (job && (['done','failed'].includes(job.status) || job.needsReview === false)) delete desk.pending[key];
        }
      });
    } catch(e) { if (alive(token)) error(e); }
    finally { if (alive(token)) { loading = false; paint(); } }
  }
  function paint() {
    if (!current()) return;
    for(const el of host.querySelectorAll('[data-pc-detail]')) detailState.set(el.dataset.pcDetail,el.open);
    const scroller = host.closest('.content') || document.scrollingElement;
    const y = scroller?.scrollTop || 0;
    const p = getProject();
    const desk = d();
    const tab = desk.tab;
    host.innerHTML = `<div class="pc-desk">${shell(p, desk, tab)}${picker ? pop(picker) : ''}${preview ? imageDialog(preview) : ''}${historyView ? historyDialog(historyView) : ''}</div>`;
    for(const el of host.querySelectorAll('[data-pc-detail]')) if(detailState.has(el.dataset.pcDetail))el.open=detailState.get(el.dataset.pcDetail);
    if (scroller) scroller.scrollTop = y;
    if (cite && tab === 'script') focusSource();
  }
  function shell(p, desk, tab) {
    const showRail = true;
    return `<div class="pc-head"><p class="pc-kicker">剧爆棚 · 分镜参考图</p><h1 class="pc-title">${E(p.title || '未命名')}</h1><p class="pc-sub">${E(tabHint(tab))}</p></div>
      ${queue ? `<div class="pc-queue"><span>正在出 ${E(queue.label)}${queue.left ? ` · 还剩 ${queue.left}` : ''}</span><button type="button" data-pc="cancel">取消</button></div>` : ''}
      ${episodeBar(p,desk)}${serviceBar(desk,tab)}<div class="pc-tabs" aria-label="制作流程">${TABS.map(t => `<button type="button" data-pc="tab" data-tab="${t.id}" class="${tab === t.id ? 'on' : ''}" ${queue ? 'disabled' : ''}>${t.label}</button>`).join('')}</div>
      <div class="pc-layout ${showRail ? '' : 'pc-solo'}">${showRail ? rail(desk) : ''}<div class="pc-main">${body(p, desk, tab)}</div></div>`;
  }
  function tabHint(tab) {
    return {script:'可贴一整部。用「第1集 / 第2集」分开。选好集数后拆解。已有图片和历史版本会保留，改过的原文会生成新镜头条目。', breakdown:'拆开之后按人物、场景、道具和分镜分开看。出图去对应页。', characters:'正面、侧面、背面，再加八种表情。同一张主参考锁住脸和服装。', locations:'中间白模是鸟瞰。先出白模，再出北机位；西、东参考北机位和白模；南机位补背面。', props:'先看材质、磨损、谁在用，再出道具主图。', storyboard:'每张图钉着剧本原文。写下到下一张的间隔。过肩镜头分开出正打和反打。'}[tab] || '';
  }
  function rail(desk) {
    return `<aside class="pc-rail"><details class="pc-settings" data-pc-detail="settings" ${globalThis.innerWidth > 900 || !globalThis.innerWidth ? 'open' : ''}><summary>出图设置</summary><div><p class="pc-kicker">画幅</p><div class="pc-pills">${ASPECTS.map(a => `<button type="button" data-pc="aspect" data-id="${a.id}" class="${episodeAspectOf(desk) === a.id ? 'on' : ''}">${a.label}</button>`).join('')}</div><label class="pc-check"><input type="checkbox" data-pc-field="forceChar" ${desk.forceChar ? 'checked' : ''}>强制人物画幅</label></div><div><p class="pc-kicker">分辨率</p><div class="pc-pills">${RESOLUTIONS.map(r => `<button type="button" data-pc="resolution" data-id="${r.id}" class="${desk.resolution === r.id ? 'on' : ''}">${r.label}</button>`).join('')}</div></div><div><p class="pc-kicker">出图风格</p><div class="pc-pills">${LOOK_STYLES.map(s => `<button type="button" data-pc="look" data-id="${E(s.id)}" class="${desk.look === s.id ? 'on' : ''}" title="${E(s.hint || '')}">${E(s.label)}</button>`).join('')}</div></div><div><p class="pc-kicker">素材范围</p><div class="pc-pills">${[['all','全部'],['series','通用'],['episode','本集']].map(([id,label]) => `<button type="button" data-pc="scope" data-id="${id}" class="${desk.scope === id ? 'on' : ''}">${label}</button>`).join('')}</div></div></details></aside>`;
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
  function scriptKey() { return d().scriptAll ? '@all' : d().episode; }
  function scriptPane(p) {
    const desk=d(), part=scriptWindow(p,desk.scriptAll),draft=desk.scriptDrafts?.[scriptKey()],text=draft?.text ?? part.text,dirty=!!draft && draft.text!==part.text;
    return `${batchBar('拆解本集', '只更新本集条目，已有图片和历史版本会保留。', 'parse', !text.trim())}
      <div class="pc-card"><div class="pc-row"><p class="pc-kicker">${desk.scriptAll ? '全剧原文 · 可一次粘贴多集' : '本集剧本 · 可粘贴或导入'}</p><div class="pc-row"><button type="button" data-pc="import">导入文件</button><button type="button" data-pc="script-restore" ${dirty ? '' : 'disabled'}>还原</button><button type="button" data-pc="script-save" ${dirty ? '' : 'disabled'}>保存剧本</button></div></div>
      <input type="file" data-pc-file accept=".txt,.md,.doc,.docx,.dotx,.rtf,.fountain,.fdx,.html,.htm,.xml,text/plain" hidden>
      <textarea class="pc-script" data-pc-field="script" placeholder="场次、动作、对白……">${E(text)}</textarea><p class="pc-muted" data-pc-draft-state>${dirty ? '草稿已暂存，保存后用于制作。' : '已保存。'}</p><div class="pc-row"><button type="button" data-pc="script-mode">${desk.scriptAll ? '只看本集' : '编辑全剧原文 / 粘贴多集'}</button><button type="button" data-pc="sample">填入《夜渡》示例</button></div>
      <label>本集风格锁<input data-pc-field="episodeStyle" value="${E(desk.episodeStyles?.[desk.episode] || '')}" placeholder="例如：冷调、雨夜、胶片质感，出图自动沿用"></label><p class="pc-muted">支持 Word（doc/docx）、txt、fountain、fdx、RTF。PDF 请先另存 Word / txt。</p></div>`;
  }
  function shown(list) {
    const scope = d().scope;
    return visibleRows(d(),list);
  }
  function breakdownPane(desk) {
    const chars = shown(desk.characters), locs = shown(desk.locations), props = shown(desk.props);
    const block = (title, tab, rows, empty, render) => `<section class="pc-card"><div class="pc-row"><h2>${title} ${rows.length}</h2><button type="button" data-pc="tab" data-tab="${tab}">去出图</button></div><ul class="pc-list">${rows.map(render).join('') || `<li class="pc-empty">${empty}</li>`}</ul></section>`;
    return `<p class="pc-muted">${desk.characters.length || desk.beats.length ? '拆开了。出图去对应页。' : '先拆解本集。'}</p>
      ${block('人物', 'characters', chars, '先拆解本集', c => `<li><b>${E(c.name)}</b> <small>${E([c.role, c.age, c.gender].filter(Boolean).join(' · '))}</small><p>${E(c.appearance || '外貌待补')}</p>${c.costume ? `<p>服装：${E(c.costume)}</p>` : ''}</li>`)}
      ${block('场景', 'locations', locs, '先拆解本集', l => `<li><b>${E(l.name)}</b><p class="pc-muted">${E(l.heading || '')}</p><p>${E(l.description || '空间待补')}</p></li>`)}
      ${block('道具', 'props', props, '本集没有单独列出的关键道具', p => `<li><b>${E(p.name)}</b> <small>${E(p.category || '道具')}</small><p>${E(p.description || '用途待补')}${p.used_by ? ` · ${E(p.used_by)}` : ''}</p></li>`)}
      ${block('连续分镜', 'storyboard', shownBeats(), '先拆解本集', b => `<li><p class="pc-mono">#${String(b.seq).padStart(2,'0')} · ${E(b.shot_size || b.shot_type || '')} · ${E(b.duration_sec)}s</p><b>${E(b.scene_heading || '分镜')}</b><p>${E(b.action || b.dialogue || '')}</p></li>`)}`;
  }
  function scopeBtn(kind, item) {
    return `<button type="button" data-pc="flip" data-kind="${kind}" data-id="${E(item.id)}">${item.scope === 'series' ? '收回本集' : '设为通用'}</button>`;
  }
  function still(entityId, kind, label, aspect) {
    const key = `${entityId}:${kind}`, image = slotImage(getProject(),d(),key), busy = busyKey === key;
    const ratio = slotAspect(batchOf(kind),kind).replace(':',' / '), pending = d().pending[key];
    const attrs = `data-id="${E(entityId)}" data-kind="${E(kind)}" data-batch="${batchOf(kind)}"`;
    return `<figure class="pc-still"><button type="button" class="pc-frame" style="aspect-ratio:${ratio}" data-pc="view" ${attrs} ${image.src ? '' : 'disabled'} aria-label="查看${E(label)}">${image.src ? `<img src="${E(image.src)}" alt="${E(label)}" loading="lazy">` : `<span>${busy ? '正在出…' : pending ? '结果待核对' : '待出'}</span>`}</button><figcaption>${E(label)}${image.locked ? ' · 已锁定' : ''}</figcaption>
      <div class="pc-still-actions"><button type="button" data-pc="one" ${attrs} ${queue || pending || image.locked ? 'disabled' : ''}>${busy ? '出图中' : image.src ? '重出' : '出这张'}</button><button type="button" data-pc="slot" ${attrs}>${image.src ? '查看 / 改图' : '参考 / 提示词'}</button></div></figure>`;
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
      <ol class="pc-stack">${list.map(c => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="characters" data-id="${E(c.id)}" data-key="name" value="${E(c.name)}"><small class="pc-chip">${c.scope === 'series' ? '全剧' : '本集'}</small><p class="pc-muted">${E(c.role)} · ${E(c.age)} · ${E(c.gender)}</p></div><div class="pc-row">${scopeBtn('characters', c)}<button type="button" data-pc="download-entity" data-id="${E(c.id)}" data-batch="characters">下载这个人</button><button type="button" data-pc="batch-one" data-batch="characters" data-id="${E(c.id)}">${queue?.entityId === c.id ? '取消' : '出这个人'}</button><button type="button" data-pc="del-char" data-id="${E(c.id)}">删除</button></div></div>
        <details class="pc-bio" data-pc-detail="bio:${E(c.id)}"><summary>人物设定与质感 · 点击展开</summary><div class="pc-grid3"><label>身份<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="role" value="${E(c.role || '')}"></label><label>年龄<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="age" value="${E(c.age || '')}"></label><label>性别<input data-pc-entity="characters" data-id="${E(c.id)}" data-key="gender" value="${E(c.gender || '')}"></label></div><label>外貌<textarea data-pc-entity="characters" data-id="${E(c.id)}" data-key="appearance" rows="3">${E(c.appearance || '')}</textarea></label><label>服装<textarea data-pc-entity="characters" data-id="${E(c.id)}" data-key="costume" rows="2">${E(c.costume || '')}</textarea></label>${gradeBox(c.id)}</details>
        <p class="pc-kicker">三视图 · 各一张</p><div class="pc-grid3">${VIEWS.map(v => still(c.id, v.kind, v.label, v.aspect)).join('')}</div>
        <p class="pc-kicker">八种表情 · 单人面部特写</p><div class="pc-grid8">${EXPRS.map(v => still(c.id, v.kind, v.label, v.aspect)).join('')}</div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现人物，也可以点上面的增加人物。</p>'}${fuseBox()}`;
  }
  function gradeBox(id) {
    const g = d().grades[id] || {};
    const groups = [...GRADES, {key:'emotion',label:'表演',options:[['','保持设定'],...PORTRAIT_EMOTIONS.map(o=>[o.id,o.label])]}];
    return `<details class="pc-grade"><summary>人物质感与表演</summary><div class="pc-grid3">${groups.map(group => `<label>${group.label}<select data-pc-grade="${group.key}" data-id="${E(id)}">${group.options.map(([v, label]) => `<option value="${v}" ${g[group.key] === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`).join('')}</div></details>`;
  }
  function locationsPane(desk) {
    const list = shown(desk.locations);
    return `${batchBar('出本集场景', '中间白模是鸟瞰。先出白模，再出北机位；左右参考北机位和白模；南机位再根据左右补背面。', 'batch-locations', !list.length)}
      <ol class="pc-stack">${list.map(l => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="locations" data-id="${E(l.id)}" data-key="name" value="${E(l.name)}"><small class="pc-chip">${l.scope === 'series' ? '全剧' : '本集'}</small><p class="pc-muted">${E(l.heading || '')}</p><label>空间描述<textarea data-pc-entity="locations" data-id="${E(l.id)}" data-key="description">${E(l.description || '')}</textarea></label><p class="pc-kicker">俯视：上北下南 · 左西右东。先出俯视白模，四向只从这张图的四边拍。</p></div><div class="pc-row">${scopeBtn('locations', l)}<button type="button" data-pc="download-entity" data-id="${E(l.id)}" data-batch="locations">下载这个场景</button><button type="button" data-pc="batch-one" data-batch="locations" data-id="${E(l.id)}">${queue?.entityId === l.id ? '取消' : '出这个场景'}</button></div></div>
        <div class="pc-grid3">${[['time_of_day','时间'],['weather','天气'],['atmosphere','氛围'],['world_anchors','空间锚点 / 门窗家具方位']].map(([key,label])=>`<label>${label}<textarea data-pc-entity="locations" data-id="${E(l.id)}" data-key="${key}" rows="2">${E(l[key] || '')}</textarea></label>`).join('')}</div>
        <div class="pc-picks">${pick('locations' , l.id, 'shot_size', '景别', L.SHOT_SIZES, l.shot_size || '全景')}${pick('locations', l.id, 'composition', '机位', L.ANGLES, l.composition || '眼睛平视')}${pick('locations', l.id, 'camera_move', '运镜', L.CAMERA_MOVES, l.camera_move || '固定镜头')}${pick('locations', l.id, 'lighting', '光影', L.LIGHTINGS, l.lighting || '自然光')}</div>
        <div class="pc-cross"><span></span>${still(l.id,'view_n','北机位', slotAspect('locations','view_n'))}<span></span>${still(l.id,'view_w','西机位', slotAspect('locations','view_w'))}${still(l.id,'plan','俯视白模','1:1')}${still(l.id,'view_e','东机位', slotAspect('locations','view_e'))}<span></span>${still(l.id,'view_s','南机位', slotAspect('locations','view_s'))}<span></span></div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现场景。</p>'}${fuseBox()}`;
  }
  function propsPane(desk) {
    const list = shown(desk.props);
    return `${batchBar('出本集道具', '点一次排队出完所有空位。已有的图不会覆盖。', 'batch-props', !list.length)}
      <ol class="pc-stack">${list.map(item => `<li class="pc-card"><div class="pc-row"><div><input class="pc-name" data-pc-entity="props" data-id="${E(item.id)}" data-key="name" value="${E(item.name)}"><small class="pc-chip">${item.scope === 'series' ? '全剧' : '本集'}</small><label>道具描述<textarea data-pc-entity="props" data-id="${E(item.id)}" data-key="description">${E(item.description || '')}</textarea></label></div>${scopeBtn('props', item)}</div><div class="pc-prop">${still(item.id,'hero','道具主图','1:1')}</div>
        <div class="pc-grid3"><label>材质 / 磨损<textarea data-pc-entity="props" data-id="${E(item.id)}" data-key="material" rows="2">${E(item.material || '')}</textarea></label><label>谁在用<input data-pc-entity="props" data-id="${E(item.id)}" data-key="used_by" value="${E(item.used_by || '')}"></label><label>叙事功能<textarea data-pc-entity="props" data-id="${E(item.id)}" data-key="significance" rows="2">${E(item.significance || '')}</textarea></label></div></li>`).join('')}</ol>
      ${list.length ? '' : '<p class="pc-empty">拆解后出现道具。</p>'}${fuseBox()}`;
  }
  function storyGroupsOf(beats){const groups=[];for(const b of beats){const code=sceneCode(b.scene_heading);const last=groups[groups.length-1];if(!last||last.code!==code)groups.push({id:code,code,beats:[b]});else last.beats.push(b)}return groups}
  function storyPane(desk) {
    const all=shownBeats(), q=storyQuery, searching=!dragEnabled(q);
    const rows=!q.trim()?all:all.filter(b=>[sceneCode(b.scene_heading),b.scene_heading,b.action,b.dialogue].filter(Boolean).join('\n').toLowerCase().includes(q.trim().toLowerCase()));
    const groups=storyGroupsOf(rows);
    return `${batchBar('按参考出本集分镜', '点一次排队出完所有空位。过肩可一次出正反打。已有的图不会覆盖。', 'batch-storyboard', !shownBeats().length)}
      <div class="pc-find"><input type="search" data-pc-find="storyboard" value="${E(q)}" placeholder="查找场号、动作、对白" aria-label="查找场号、动作、对白"><span class="pc-muted">${searching?'查找时不能拖动场次或镜头':''}</span></div>
      <div class="pc-stack">${groups.map(g=>`<section class="pc-scene" data-scene="${E(g.id)}"><div class="pc-row"><button type="button" data-pc="drag-scene" data-scene="${E(g.id)}" draggable="${searching?'false':'true'}" ${searching?'disabled':''}>拖动场次</button><button type="button" data-pc="add-scene" data-scene="${E(g.id)}">这场后面加一场</button><small class="pc-chip">${g.beats.length} 镜</small></div><ol class="pc-stack">${g.beats.map(b=>beatCard(desk,b,all[all.indexOf(b)+1],searching)).join('')}</ol></section>`).join('')}</div>
      <button type="button" class="pc-ghost" data-pc="add-scene">增加一场</button><button type="button" class="pc-ghost" data-pc="add-beat">插入一段</button><details class="pc-card"><summary>归档分镜 · ${desk.archivedShots.filter(b=>b.episode === desk.episode).length} 镜</summary><p class="pc-muted">原文改动后未匹配的旧镜头保存在这里，旧图仍可查看。</p>${desk.archivedShots.filter(b=>b.episode === desk.episode).map(b=>`<p>${E(b.scene_heading)} · ${E((b.action || b.dialogue || '').slice(0,100))}<button type="button" data-pc="restore-beat" data-id="${E(b.id)}">恢复这镜</button></p>`).join('')}</details>
      ${shownBeats().length ? (rows.length?'':'<p class="pc-empty">没有对上的分镜</p>') : '<p class="pc-empty">拆解后出现连续分镜。</p>'}${fuseBox()}`;
  }
  function beatCard(desk, b, next, searching=false) {
    const ots = (b.composition || '') === '过肩镜头';
    const from = desk.characters.find(c => c.id === b.ots_from)?.name;
    const to = desk.characters.find(c => c.id === b.ots_to)?.name;
    return `<li class="pc-card pc-beat"><div>${still(b.id,'frame', ots && from && to ? `正打 · 过${from}肩拍${to}` : '分镜', slotAspect('storyboard','frame'))}${ots ? still(b.id,'reverse', from && to ? `反打 · 过${to}肩拍${from}` : '反打', slotAspect('storyboard','reverse')) + `<button type="button" class="pc-go" data-pc="pair" data-id="${E(b.id)}" ${queue || !b.ots_from || !b.ots_to || b.ots_from === b.ots_to ? 'disabled' : ''}>一次出正反打</button>` : ''}</div>
      <div><div class="pc-times"><label>开始<input type="number" min="0" step="0.5" data-pc-beat="${E(b.id)}" data-key="start_sec" value="${Number(b.start_sec) || 0}"> <small>${fmt(b.start_sec)}</small></label><label>镜长<input type="number" min="0.5" max="60" step="0.5" data-pc-beat="${E(b.id)}" data-key="duration_sec" value="${Number(b.duration_sec) || 4}"><small>s</small></label>${next ? `<label>到下一张<input type="number" min="0" step="0.5" data-pc-beat="${E(b.id)}" data-key="next_gap_sec" value="${Number(b.next_gap_sec) || 0}"><small>s</small></label>` : '<span>终镜</span>'}</div>
        <input class="pc-name" data-pc-beat="${E(b.id)}" data-key="scene_heading" value="${E(b.scene_heading || '分镜')}">
        <label>画面与动作<textarea data-pc-beat="${E(b.id)}" data-key="action" rows="3">${E(b.action || '')}</textarea></label><label>台词<textarea data-pc-beat="${E(b.id)}" data-key="dialogue" rows="2">${E(b.dialogue || '')}</textarea></label>${b.script_excerpt ? `<button type="button" class="pc-excerpt" data-pc="cite" data-id="${E(b.id)}">原文 · ${E(b.script_excerpt.slice(0, 80))}</button>` : ''}
        <div class="pc-picks">${pick('beats', b.id, 'shot_size', '景别', L.SHOT_SIZES, b.shot_size || b.shot_type || '中景')}${pick('beats', b.id, 'composition', '机位', L.ANGLES, b.composition || '眼睛平视')}${pick('beats', b.id, 'framing', '构图', L.COMPOSITIONS, b.framing || '三分构图')}${pick('beats', b.id, 'camera_move', '运镜', L.CAMERA_MOVES, b.camera_move || '固定镜头')}${pick('beats', b.id, 'stylize', '风格化', L.STYLIZES, b.stylize || '电影叙事')}${pick('beats', b.id, 'lighting', '光影', L.LIGHTINGS, b.lighting || '电影级布光')}${pick('beats', b.id, 'technique', '特殊摄影', L.TECHNIQUES, b.technique || '', true)}</div>
        ${ots ? `<div class="pc-grid2"><label>过谁的肩<select data-pc-beat="${E(b.id)}" data-key="ots_from"><option value="">请选择人物</option>${shown(desk.characters).map(c => `<option value="${E(c.id)}" ${b.ots_from === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label><label>拍谁的脸<select data-pc-beat="${E(b.id)}" data-key="ots_to"><option value="">请选择人物</option>${shown(desk.characters).map(c => `<option value="${E(c.id)}" ${b.ots_to === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label></div>${axisPane(b,from,to)}` : ''}
        <details><summary>站位说明 / 高级编辑</summary><label>站位与视线<textarea data-pc-beat="${E(b.id)}" data-key="ots_block" rows="2" placeholder="保持视线轴，不越轴">${E(b.ots_block || '')}</textarea></label></details>${referenceChoices(b)}<div class="pc-row"><button type="button" data-pc="insert-beat" data-id="${E(b.id)}">这场加一镜</button><button type="button" data-pc="drag-beat" data-id="${E(b.id)}" draggable="${searching?'false':'true'}" ${searching?'disabled':''}>拖动镜头</button><button type="button" data-pc="video" data-id="${E(b.id)}">选图制作视频</button><button type="button" data-pc="del-beat" data-id="${E(b.id)}">移除这镜</button></div>
      </div></li>`;
  }
  function axisPane(b,from,to){
    const block=axisBlock(b.ots_block),names={a:from || 'A',b:to || 'B'};
    return `<div class="pc-axis"><p class="pc-kicker">过肩轴线 · 先选姿态，再拖白模改站位</p><p class="pc-muted">正打过 ${E(names.a)} 的肩拍 ${E(names.b)}，反打交换机位，人物姿态保持一致。</p><div class="pc-grid2">${['a','b'].map(who=>`<div><b>${E(names[who])}</b><div class="pc-pills">${POSES.map(([pose,label])=>`<button type="button" data-pc="pose" data-id="${E(b.id)}" data-who="${who}" data-pose="${pose}" class="${block[who].pose===pose?'on':''}">${label}</button>`).join('')}</div></div>`).join('')}</div><div class="pc-axis-board"><span class="pc-axis-line">180° AXIS</span><span class="pc-axis-camera">正打机位 / 反打机位保持在轴线同侧</span>${['a','b'].map(who=>`<button type="button" class="pc-axis-actor" data-pc-actor="${who}" data-beat="${E(b.id)}" style="left:${block[who].along}%;top:${50+block[who].off}%" aria-label="拖动${E(names[who])}白模">${dummySVG(block[who].pose)}<span>${E(names[who])}</span></button>`).join('')}</div><p class="pc-muted" data-pc-distance>间距约 ${axisDistance(block)} 米</p><div class="pc-grid2">${['a','b'].map(who=>`<label>${E(names[who])} 横向位置（也可拖动白模）<input type="range" min="8" max="92" value="${block[who].along}" data-pc-axis-position="${who}" data-beat="${E(b.id)}"></label>`).join('')}</div></div>`;
  }
  function pick(list, id, key, label, options, value, allowEmpty = false) {
    return `<label class="pc-pick"><span>${label}</span><select data-pc-entity="${list}" data-id="${E(id)}" data-key="${key}">${opt(options, value, allowEmpty)}</select><button type="button" data-pc="guide" data-list="${list}" data-id="${E(id)}" data-key="${key}">看示例 / 白模</button></label>`;
  }
  function fuseBox() {
    const category = d().tab, refs = d().fuse[category] || [];
    return `<details class="pc-card"><summary>额外参考 · ${refs.length} 张</summary><p class="pc-muted">只用于当前页；与自动参考合计最多3张，单张≤768KB。</p><input type="file" data-pc-fuse accept="image/png,image/jpeg,image/webp" multiple><div class="pc-ref-thumbs">${refs.map(src=>`<img src="${E(imageURL(src))}" alt="额外参考">`).join('')}</div><button type="button" data-pc="clear-fuse">清空额外参考</button></details>`;
  }
  function episodeBar(p,desk) {
    return `<div class="pc-row pc-episode"><label>正在制作 <select aria-label="正在制作的集数" data-pc-field="episode" ${queue ? 'disabled' : ''}>${episodeNames(p).map(name=>`<option ${name === desk.episode ? 'selected' : ''}>${E(name)}</option>`).join('')}</select></label><span class="pc-muted">原文 → 拆解 → 选图 → 连续分镜</span><button type="button" data-pc="gallery">我的图库 / 自由出图</button></div>`;
  }
  function serviceBar(desk,tab) {
    const pending = Object.keys(desk.pending).length;
    if (tab === 'script' || tab === 'breakdown') return message ? `<p class="pc-notice" role="status">${E(message)}</p>` : '';
    const count = status?.rates?.image, available = status?.wallet?.available;
    return `<div class="pc-notice" role="status"><span>${!getUser() ? '请先登录本站账号，图片归当前账号保存' : !status ? '正在读取出图服务状态' : pending ? '上次出图结果待核对，请先刷新；不会自动重试' : status.configured ? '出图服务已配置，是否出图成功以任务结果为准' : '模型服务尚未连接，可导入图片并选图制作'}${count != null ? ` · 每张约 ${Number(count).toLocaleString('zh-CN')} 估算 token` : ''}${status?.wallet ? ` · 可用 ${available == null ? '不限额' : Number(available).toLocaleString('zh-CN')}` : ''}</span><button type="button" data-pc="refresh" ${loading ? 'disabled' : ''}>刷新任务 / 图库</button>${message ? `<p>${E(message)}</p>` : ''}</div>`;
  }
  function referenceChoices(b) {
    const desk = d(), parts = [];
    for (const category of ['characters','locations','props']) {
      const field = {characters:'characterNames',locations:'locationNames',props:'propNames'}[category];
      const entities = desk[category].filter(e=>!e.archived && (e.scope === 'series' || e.episode === b.episode) && ((b[field] || []).includes(e.name) || category === 'characters' && [b.ots_from,b.ots_to].includes(e.id)));
      for (const entity of entities) {
        const selected = b.refChoices?.[entity.id] || (category === 'characters' ? 'front' : category === 'locations' ? 'view_n' : 'hero');
        const src = slotImage(getProject(),desk,`${entity.id}:${selected}`).src;
        parts.push(`<label class="pc-reference">${src ? `<img src="${E(src)}" alt="${E(entity.name)}参考">` : '<span>待出参考</span>'}<span>${E(entity.name)}<select data-pc-ref="${E(entity.id)}" data-beat="${E(b.id)}">${IMAGE_SLOTS[category].map(s=>`<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${s.label}${slotImage(getProject(),desk,`${entity.id}:${s.id}`).src ? '' : ' · 尚未出图'}</option>`).join('')}</select></span></label>`);
      }
    }
    const shot = getProject().shots.find(s=>s.id === b.id);
    return `<details class="pc-grade"><summary>人物 / 场景 / 道具参考 · 自动保持对应关系</summary><p class="pc-muted">选人物表情或场景机位。实际最多用3张，优先过肩两人、人物、场景、道具；额外参考超限会提示。</p><div class="pc-ref-stack">${parts.join('') || '<p>这一镜尚未标注人物或道具，可以在下方选择项目图片。</p>'}</div>${[['characters','人物'],['locations','场景'],['props','道具']].map(([key,label])=>`<label>${label}项目参考<select multiple data-pc-shot-ref="${key}" data-beat="${E(b.id)}">${getProject().assets.filter(a=>a.kind === 'image').map(a=>`<option value="${E(a.id)}" ${(shot?.[key] || []).includes(a.id) ? 'selected' : ''}>${E(a.name)}</option>`).join('')}</select></label>`).join('')}</details>`;
  }
  function imageDialog(state) {
    const key = `${state.id}:${state.kind}`, image = slotImage(getProject(),d(),key), entity = entityOf(state.batch,state.id);
    let prompt = d().prompts[key] || image.item?.prompt || '';
    if (!prompt) try { prompt = promptFor(state.batch,entity,state.kind); } catch(e) { prompt = memberError(e.message); }
    const grade = d().slotGrades[key] || {};
    return `<div class="pc-pop" role="dialog" aria-modal="true" aria-label="图片与版本"><div class="pc-pop-card pc-image-dialog"><div class="pc-row"><h2>${E(entity?.name || entity?.scene_heading || '图片')} · ${E(IMAGE_SLOTS[state.batch]?.find(s=>s.id === state.kind)?.label || state.kind)}</h2><button type="button" data-pc="close-image">关闭</button></div>${image.src ? `<img class="pc-large-image" src="${E(image.src)}" alt="当前图片"><div class="pc-row"><a href="${E(image.item?.id ? contentURL(image.item.id)+'&download=1' : image.src)}" download="参考图.png">下载原图</a><button type="button" data-pc="use-current" ${queue ? 'disabled' : ''}>选用这张</button><button type="button" data-pc="drop" data-id="${E(state.id)}" data-kind="${state.kind}" ${image.locked || queue ? 'disabled' : ''}>删除此版本</button>${image.locked ? '<small>管理员已锁定，仍可查看和使用</small>' : ''}</div><label>用自然语言改图<textarea data-pc-edit rows="3" placeholder="例如：保留人物和服装，将光线改为傍晚逆光" ${image.locked || queue ? 'disabled' : ''}>${E(state.edit || '')}</textarea></label><button type="button" data-pc="edit-image" ${image.locked || queue ? 'disabled' : ''}>生成修改版</button>` : '<p class="pc-empty">这个位置还没有图片，可以先导入或从图库选择。</p>'}<div class="pc-row"><button type="button" data-pc="history" ${queue ? 'disabled' : ''}>历史版本</button><button type="button" data-pc="pick-library" ${queue ? 'disabled' : ''}>从我的图库选图</button></div><label>导入到这个位置（≤3MB）<input type="file" data-pc-slot-import accept="image/png,image/jpeg,image/webp" ${image.locked || queue ? 'disabled' : ''}></label><details><summary>单图参考与质感设置</summary><label>这张图的额外参考（合计最多3张）<input type="file" data-pc-slot-refs multiple accept="image/png,image/jpeg,image/webp" ${queue ? 'disabled' : ''}></label><div class="pc-ref-thumbs">${(d().slotRefs[key] || []).map(src=>`<img src="${E(imageURL(src))}" alt="单图参考">`).join('')}</div><button type="button" data-pc="clear-slot-refs">恢复本页额外参考</button><div class="pc-grid3">${[...PORTRAIT_STYLES,{key:'emotion',label:'表演',options:PORTRAIT_EMOTIONS}].map(g=>`<label>${g.label}<select data-pc-slot-grade="${g.key}"><option value="">沿用人物设定</option>${g.options.map(o=>`<option value="${o.id}" ${grade[g.key] === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>`).join('')}</div><button type="button" data-pc="clear-slot-grade">恢复人物设定</button></details><details><summary>原始提示词</summary><p class="pc-prompt">${E(prompt)}</p><button type="button" data-pc="copy-prompt">复制完整提示词</button></details></div></div>`;
  }
  function historyDialog(state) {
    const key = `${state.id}:${state.kind}`;
    const local = state.all ? [] : (d().history[key] || []).filter(i=>typeof i === 'string' && imageURL(i));
    return `<div class="pc-pop" role="dialog" aria-modal="true" aria-label="历史版本"><div class="pc-pop-card pc-image-dialog"><div class="pc-row"><h2>${state.all ? '我的图库' : '历史版本'}</h2><button type="button" data-pc="close-history">关闭</button></div>${state.loading ? '<p>正在读取…</p>' : `<div class="pc-history-grid">${state.items.map(i=>`<article><img src="${E(contentURL(i.id))}" alt="${E(i.name)}"><p>${E(i.name)}${i.adminLocked ? ' · 已锁定' : ''}</p><button type="button" data-pc="choose-version" data-id="${E(i.id)}">选用这张</button><button type="button" data-pc="delete-version" data-id="${E(i.id)}" ${i.adminLocked ? 'disabled' : ''}>删除此版本</button><a href="${E(contentURL(i.id))}&download=1" download>下载</a></article>`).join('')}${local.map((src,index)=>`<article><img src="${E(src)}" alt="本地旧版本"><button type="button" data-pc="choose-local" data-index="${index}">选用本地旧版本</button></article>`).join('')}</div><div class="pc-row"><button type="button" data-pc="history-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${state.page} 页 · ${state.total} 张</span><button type="button" data-pc="history-next" ${state.page*24 >= state.total ? 'disabled' : ''}>下一页</button></div>`}</div></div>`;
  }
  async function loadHistory(target,all=false,page=1) {
    const token = capture(), state = {...target,all,page,items:[],total:0,loading:true};
    historyView = state; paint();
    try {
      const r = await request('list',null,{page:String(page),...(all ? {} : {projectId:getProject().id,entityId:target.id,slot:target.kind})});
      if (!alive(token) || historyView !== state) return;
      const local=all || page!==1?[]:(d().history[`${target.id}:${target.kind}`] || []).filter(i=>i?.id && contentURL(i.id));const items=[...(r.items || []),...local.filter(i=>!(r.items || []).some(x=>x.id===i.id))];Object.assign(state,{items,total:Math.max(r.total || 0,items.length),loading:false}); paint();
    } catch(e) { if (alive(token) && historyView === state) { historyView=null; error(e); } }
  }
  function focusSource() {
    const el=host?.querySelector('[data-pc-field="script"]'); if (!el || !cite) return;
    const start=el.value.indexOf(cite); if(start >= 0) { el.focus(); el.setSelectionRange(start,start+cite.length); }
    cite='';
  }
  function forgetImage(image){
    const p=getProject(),desk=d(),id=image.item?.id || image.id,asset=image.asset || p.assets.find(a=>a.id===id || a.imageLibraryId===id);
    if(id)removeReferences(p,id);if(asset)removeReferences(p,asset.id);
    for(const key of new Set([...Object.keys(desk.images),...Object.keys(desk.stills)])){
      if(desk.images[key]?.id===id || image.src && desk.stills[key]===image.src){delete desk.images[key];delete desk.stills[key];}
      desk.history[key]=(desk.history[key] || []).filter(i=>typeof i==='string'?i!==image.src:i.id!==id);
    }
    for(const b of desk.beats){if([id,asset?.id].filter(Boolean).includes(b.frameAssetId))b.frameAssetId='';if([id,asset?.id].filter(Boolean).includes(b.reverseAssetId))b.reverseAssetId='';}syncShots(p,desk);
  }
  async function extraAction(act,btn) {
    if(act==='pose'){commit(()=>{const b=d().beats.find(b=>b.id===btn.dataset.id);if(b){const block=axisBlock(b.ots_block);block[btn.dataset.who].pose=btn.dataset.pose;b.ots_block=JSON.stringify(block);syncShots(getProject(),d())}});return true;}
    if(act==='download-entity'){const token=capture(),entity=entityOf(btn.dataset.batch,btn.dataset.id),entries=[];for(const slot of IMAGE_SLOTS[btn.dataset.batch] || []){const image=slotImage(getProject(),d(),`${entity.id}:${slot.id}`);if(!image.src)continue;const src=await imageData(image.src);if(!alive(token))return true;const mime=src.slice(5,src.indexOf(';')),bytes=Uint8Array.from(atob(src.split(',')[1]),c=>c.charCodeAt(0));entries.push([slot.label+'.'+(mime==='image/jpeg'?'jpg':mime==='image/webp'?'webp':'png'),bytes]);}if(!entries.length)throw Error('还没有可下载的图片');const url=URL.createObjectURL(new Blob([zipStore(entries)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=(entity.name || '参考图').replace(/[\\/:*?"<>|]/g,'_')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}
    if(act==='delete-version' && historyView){const item=historyView.items.find(i=>i.id===btn.dataset.id),token=capture(),target={...historyView};if(!item)return true;if(item.adminLocked || slotImage(getProject(),d(),`${target.id}:${target.kind}`).locked)throw Error('管理员已锁定，不能删除');if(!confirm('删除这个历史版本？此操作不可恢复。'))return true;await request('delete',{id:item.id});if(!alive(token))return true;commit(()=>forgetImage({item,src:contentURL(item.id)}));await loadHistory(target,target.all,target.page);return true;}
    if (act === 'refresh') { await refresh(); return true; }
    if (act === 'guide') {
      const mapping={shot_size:'size',composition:'angle',camera_move:'camera',framing:'framing',stylize:'stylize',lighting:'lighting',technique:'technique'};
      const row=listOf(btn.dataset.list).find(e=>e.id === btn.dataset.id), token=capture();
      if(!row)return true;
      const subject=Object.fromEntries(Object.entries(mapping).map(([k,v])=>[v,row[k]]));
      Guide.open({project:getProject(),subject,key:mapping[btn.dataset.key],title:'镜头语言 · 对照示例',onApply:(key,value)=>{ if(alive(token))patchEntity(btn.dataset.list,row.id,Object.keys(mapping).find(k=>mapping[k] === key),value); }}); return true;
    }
    if (act === 'gallery') { onGallery(); return true; }
    if (act === 'clear-fuse') { commit(()=>d().fuse[d().tab]=[]); return true; }
    if (act === 'close-image') { preview=null; paint(); return true; }
    if (act === 'close-history') { historyView=null; paint(); return true; }
    if (act === 'view' || act === 'slot') { preview={id:btn.dataset.id,kind:btn.dataset.kind,batch:btn.dataset.batch}; paint(); return true; }
    if (act === 'clear-slot-refs' && preview) { commit(()=>delete d().slotRefs[`${preview.id}:${preview.kind}`]); return true; }
    if (act === 'clear-slot-grade' && preview) { commit(()=>delete d().slotGrades[`${preview.id}:${preview.kind}`]); return true; }
    if (act === 'copy-prompt' && preview) { const key=`${preview.id}:${preview.kind}`; await navigator.clipboard.writeText(d().prompts[key] || promptFor(preview.batch,entityOf(preview.batch,preview.id),preview.kind)); toast('完整提示词已复制'); return true; }
    if (['history','pick-library','history-prev','history-next'].includes(act)) {
      const target=historyView || preview; if (!target) return true;
      await loadHistory(target,act === 'pick-library' || !!historyView?.all,act === 'history-prev' ? Math.max(1,target.page-1) : act === 'history-next' ? target.page+1 : 1); return true;
    }
    if (act === 'choose-version' && historyView) {
      const target={...historyView}, item=historyView.items.find(i=>i.id === btn.dataset.id); if(!item)return true;
      if(slotImage(getProject(),d(),`${target.id}:${target.kind}`).locked)throw Error('当前图片已锁定，不能替换');
      commit(()=>acceptImage(getProject(),d(),`${target.id}:${target.kind}`,item)); historyView=null; paint(); await attachImage(target.id,target.kind,item); return true;
    }
    if (act === 'choose-local' && historyView) {
      const target={...historyView},key=`${target.id}:${target.kind}`;
      if(slotImage(getProject(),d(),key).locked)throw Error('当前图片已锁定，不能替换');
      const src=(d().history[key] || []).filter(i=>typeof i === 'string' && imageURL(i))[Number(btn.dataset.index)];
      if(src)commit(()=>{ const p=getProject(),desk=d(),old=desk.images[key] || desk.stills[key];if(old)(desk.history[key] ||= []).push(old);delete desk.images[key];desk.stills[key]=src;const asset=p.assets.find(a=>a.src===src) || {id:uid(),name:'历史参考图',kind:'image',type:target.batch==='storyboard'?'分镜':'参考图',src,created:Date.now(),locked:false};if(!p.assets.some(a=>a.id===asset.id))p.assets.push(asset);const b=desk.beats.find(b=>b.id===target.id);if(b && ['frame','reverse'].includes(target.kind)){b[target.kind==='frame'?'frameAssetId':'reverseAssetId']=asset.id;syncShots(p,desk)} }); historyView=null; paint(); return true;
    }
    if (act === 'use-current' && preview) {
      const {id,kind}=preview,item=d().images[`${id}:${kind}`]; if(item)await attachImage(id,kind,item);else{const image=slotImage(getProject(),d(),`${id}:${kind}`);if(!image.src)throw Error('请先选择图片');} toast('已选用到项目'); return true;
    }
    if (act === 'edit-image' && preview) {
      const image=slotImage(getProject(),d(),`${preview.id}:${preview.kind}`);
      if(image.locked)throw Error('管理员已锁定，不能修改'); if(!preview.edit?.trim())throw Error('请先写修改要求');
      const {id,kind,batch,edit}=preview; preview=null;
      void runJobs([{id,kind,batch,edit:edit.trim(),parentId:image.item?.id,parentSrc:image.src,label:'修改版'}]); return true;
    }
    if (act === 'drop') {
      const key=`${btn.dataset.id}:${btn.dataset.kind}`, image=slotImage(getProject(),d(),key), token=capture();
      if(image.locked)throw Error('管理员已锁定，不能删除');
      if(!confirm('删除当前版本？其他版本和历史额度会保留。'))return true;
      if(image.item?.id) { await request('delete',{id:image.item.id}); if(!alive(token))return true; }
      commit(()=>forgetImage(image)); return true;
    }
    if (act === 'del-beat') {
      const b=d().beats.find(b=>b.id === btn.dataset.id); if(!b || !confirm('从连续分镜移除这一镜？原文和图片会保留，可在归档中恢复。'))return true;
      commit(()=>{ d().archivedShots.push({...b,shot:getProject().shots.find(s=>s.id === b.id)}); d().beats=d().beats.filter(x=>x.id!==b.id); syncShots(getProject(),d()); }); return true;
    }
    if (act === 'restore-beat') {
      commit(()=>{ const old=d().archivedShots.find(b=>b.id === btn.dataset.id); if(!old)return; if(old.shot && !getProject().shots.some(s=>s.id===old.id))getProject().shots.push(old.shot); d().beats.push(old); d().archivedShots=d().archivedShots.filter(b=>b.id!==old.id); syncShots(getProject(),d()); }); return true;
    }
    if (act === 'video') {
      const shot=getProject().shots.find(s=>s.id === btn.dataset.id); if(!shot?.assetId)throw Error('请先为这一镜生成或选用图片');
      commit(()=>{ const p=getProject(); p.settings.videoRefs=[...new Set([...(p.settings.videoRefs || []),shot.assetId])]; p.settings.firstFrame=shot.assetId; }); goto('video'); return true;
    }
    return false;
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
      if (desk.forceChar) return episodeAspectOf(desk);
      return EXPRS.some(x => x.kind === kind) ? '1:1' : '3:4';
    }
    if (kind === 'plan' || kind === 'hero') return '1:1';
    return episodeAspectOf(desk);
  }
  function promptFor(batch,entity,kind) { return prepareStill(getProject(),d(),batch,entity.id,kind).prompt; }
  function entityOf(batch,id) { return entityFor(d(),batch,id); }
  function shownBeats() { return d().beats.filter(b=>b.episode === d().episode); }
  function jobsFor(batch, onlyId) {
    const desk = d();
    const list = (batch === 'characters' ? shown(desk.characters) : batch === 'locations' ? shown(desk.locations) : batch === 'props' ? shown(desk.props) : shownBeats()).filter(item => !onlyId || item.id === onlyId);
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
    if (queue || !current()) return;
    if (!jobs.length) { toast('空位都有图了'); return; }
    const token = capture();
    queue = {left:jobs.length,label:'准备中',entityId:jobs[0].id,stop:false}; paint();
    try {
      if (!getUser()) throw Error('请先登录本站账号');
      if (!status) throw Error('请先刷新服务状态');
      if (!status.configured) throw Error('模型服务尚未连接。可以导入图片、选图和整理分镜');
      if (Object.keys(d().pending).length || (status.jobs || []).some(j=>j.needsReview || j.status === 'running')) throw Error('已有出图请求待核对，请先刷新任务，避免重复扣额');
      // Snapshot every creative choice before the first request. Only newly made
      // canonical references may be added to later jobs in this serial queue.
      const snapshot = structuredClone(getProject());
      for (let i=0;i<jobs.length;i++) {
        if (!alive(token) || queue?.stop) break;
        const job = jobs[i]; queue.label = `${job.label || '图片'} · ${IMAGE_SLOTS[job.batch]?.find(s=>s.id === job.kind)?.label || job.kind}`; queue.left = jobs.length-i; queue.entityId = job.id;
        const source = snapshot.pianchang;
        source.stills = {...d().stills}; source.images = {...d().images};
        const entity=entityFor(source,job.batch,job.id);
        const payload = job.edit ? {name:(entity.name || entity.scene_heading || '图片').slice(0,100)+' · 修改版',kind:{characters:'角色',locations:'场景',props:'道具',storyboard:'分镜'}[job.batch],ratio:slotAspect(job.batch,job.kind),resolution:source.resolution,metadata:{entityId:job.id,entityName:(entity.name || entity.scene_heading || '图片').slice(0,160),slot:job.kind,episode:entity.episode || source.episode}} : prepareStill(snapshot,source,job.batch,job.id,job.kind);
        if (job.edit) { payload.prompt = `保留原图未要求修改的部分。修改要求：${job.edit}`; payload.references = [job.parentId ? {id:job.parentId} : {dataUrl:job.parentSrc}]; if(job.parentId)payload.metadata.parentImageId = job.parentId; }
        const key = `${job.id}:${job.kind}`, requestId = uid();
        payload.requestId = requestId; payload.projectId = snapshot.id; payload.projectTitle = snapshot.title;
        busyKey = key; commit(()=>{ d().pending[key] = {id:requestId,created:Date.now()}; d().prompts[key] = payload.prompt; });
        // Persist the request identity before any network I/O. Unknown results
        // stay held across navigation/reload and are never retried automatically.
        await save(); if (!alive(token)) break;
        let result;
        try { result = await request('generate',payload); }
        catch(e) { if(alive(token) && e.rejected) commit(()=>delete d().pending[key]); throw e; }
        if (!alive(token)) return;
        resetQuota(); if(result.wallet) status.wallet=result.wallet;
        if (!['done','failed'].includes(result.job?.status)) throw Error('结果待核对，后续队列已停止；请刷新图库，不要重复提交');
        commit(()=>delete d().pending[key]);
        if (result.job.status !== 'done' || !result.item) throw Error('这张图片未生成，后续队列已停止');
        commit(()=>acceptImage(getProject(),d(),key,result.item));
        await attachImage(job.id,job.kind,result.item,token);
        if (alive(token)) message = `已完成 ${i+1} / ${jobs.length} 张，图片已存入个人图库`;
      }
    } catch(e) { if(alive(token)) error(e); }
    finally { if(alive(token)) { queue = null; busyKey = ''; paint(); } }
  }
  async function imageData(src) {
    if (imageURL(src).startsWith('data:')) return src;
    if (!imageURL(src)) throw Error('图片地址无效');
    const response = await fetchImage(src,{credentials:'same-origin'});
    if (!response.ok) throw Error('图片已入图库，但原图暂时无法读取，请稍后重新选用');
    const blob = await response.blob();
    return fileToData(blob,3*1024*1024);
  }
  async function attachImage(id,kind,item,token=capture()) {
    const src = await imageData(contentURL(item.id));
    if (!alive(token)) return;
    commit(()=>{
      const p = getProject(), desk = d();
      if (!p.assets.some(a=>a.id === item.id)) p.assets.push({id:item.id,imageLibraryId:item.id,name:item.name,kind:'image',type:item.kind,src,width:item.width,height:item.height,created:item.created,locked:false,adminLocked:item.adminLocked,description:item.prompt || '',metadata:item.metadata});
      const b = desk.beats.find(b=>b.id === id);
      if (b && ['frame','reverse'].includes(kind)) { b[kind === 'frame' ? 'frameAssetId' : 'reverseAssetId'] = item.id; syncShots(p,desk); }
    });
  }
  function parse() {
    if (queue) return;
    try { applyScriptDraft(getProject(),scriptKey()); const result = parseEpisode(getProject(),uid); change(()=>{},false); paint(); toast(`本集已拆解：人物 ${result.characters.length} · 场景 ${result.locations.length} · 道具 ${result.props.length} · 分镜 ${result.beats.length}`); }
    catch(e) { error(e); }
  }
  function syncShots(p,desk) { syncProjectShots(p,desk); }
  function listOf(name) {
    const desk = d();
    if (name === 'characters') return desk.characters;
    if (name === 'locations') return desk.locations;
    if (name === 'props') return desk.props;
    return desk.beats;
  }
  function patchEntity(list, id, key, value) {
    commit(() => {
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
    if (!current() || queue) return;
    if (el.hasAttribute('data-pc-edit') && preview) { preview.edit=el.value; return; }
    if (el.dataset.pcFind === 'storyboard') { const pos=el.selectionStart; storyQuery=el.value; paint(); const next=host.querySelector('[data-pc-find="storyboard"]'); if(next){next.focus(); try{next.setSelectionRange(pos,pos)}catch{}} return; }
    if (el.dataset.pcField === 'script') {
      const part=scriptWindow(getProject(),d().scriptAll),key=scriptKey();
      (d().scriptDrafts ||= {})[key] = {source:d().scriptDrafts?.[key]?.source ?? part.text,text:el.value};
      change(()=>{},false);
      for(const button of host.querySelectorAll('[data-pc="script-save"],[data-pc="script-restore"]'))button.disabled=el.value===part.text;
      const parseButton=host.querySelector('[data-pc="parse"]'); if(parseButton)parseButton.disabled=!el.value.trim();
      const label=host.querySelector('[data-pc-draft-state]');if(label)label.textContent=el.value===part.text?'已保存。':'草稿已暂存，保存后用于制作。';
    }
  }

  async function onChange(e) {
    if (!current()) return;
    const el = e.target, token = capture();
    if (queue) { paint(); return; }
    try {
      if(el.dataset.pcAxisPosition){commit(()=>{const b=d().beats.find(b=>b.id===el.dataset.beat);if(b){const block=axisBlock(b.ots_block);block[el.dataset.pcAxisPosition].along=Number(el.value);b.ots_block=JSON.stringify(axisBlock(block));syncShots(getProject(),d())}});return;}
      if (el.dataset.pcField === 'episode') { commit(()=>{ d().episode = el.value; }); return; }
      if (el.dataset.pcField === 'episodeStyle') { commit(()=>{ (d().episodeStyles ||= {})[d().episode]=el.value.slice(0,2000); }); return; }
      if (el.dataset.pcField === 'forceChar') { commit(()=>{ d().forceChar = el.checked; }); return; }
      if (el.dataset.pcGrade) { commit(()=>{ (d().grades[el.dataset.id] ||= {})[el.dataset.pcGrade] = el.value; }); return; }
      if (el.dataset.pcSlotGrade && preview) { commit(()=>{ (d().slotGrades[`${preview.id}:${preview.kind}`] ||= {})[el.dataset.pcSlotGrade] = el.value; }); return; }
      if (el.dataset.pcRef && el.dataset.beat) { commit(()=>{ const b=d().beats.find(b=>b.id===el.dataset.beat); if(b)(b.refChoices ||= {})[el.dataset.pcRef] = el.value; }); return; }
      if (el.dataset.pcShotRef && el.dataset.beat) { commit(()=>{ const shot=getProject().shots.find(b=>b.id===el.dataset.beat); if(shot)shot[el.dataset.pcShotRef]=[...el.selectedOptions].map(o=>o.value); }); return; }
      if (el.dataset.pcEntity && el.dataset.id && el.dataset.key) { patchEntity(el.dataset.pcEntity,el.dataset.id,el.dataset.key,el.value); return; }
      if (el.dataset.pcBeat && el.dataset.key) {
        const key=el.dataset.key, value=el.type === 'number' ? Math.max(0,Number(el.value)||0) : el.value;
        patchEntity('beats',el.dataset.pcBeat,key,key === 'duration_sec' ? Math.min(60,Math.max(.5,value||.5)) : value); return;
      }
      if (el.hasAttribute('data-pc-fuse') || el.hasAttribute('data-pc-slot-refs')) {
        const category=d().tab, slot=preview ? `${preview.id}:${preview.kind}` : '', files=[...el.files];
        if (files.length > 3) throw Error('额外参考最多3张');
        const urls=await Promise.all(files.map(file=>fileToData(file)));
        if (!alive(token)) return;
        commit(()=>{ if(el.hasAttribute('data-pc-slot-refs')) d().slotRefs[slot]=urls; else d().fuse[category]=urls; }); return;
      }
      if (el.hasAttribute('data-pc-slot-import')) {
        const target=preview && {...preview}, file=el.files?.[0]; if(!target || !file) return;
        if(slotImage(getProject(),d(),`${target.id}:${target.kind}`).locked)throw Error('管理员已锁定，不能替换');
        const dataUrl=await fileToData(file,3*1024*1024); if(!alive(token))return;
        const entity=entityOf(target.batch,target.id); if(!entity)throw Error('图片位置已变化');
        const item=(await request('import',{requestId:uid(),projectId:getProject().id,projectTitle:getProject().title,name:`${entity.name || entity.scene_heading} · ${target.kind}`.slice(0,120),kind:{characters:'角色',locations:'场景',props:'道具',storyboard:'分镜'}[target.batch],prompt:'',dataUrl,sourceId:'local-'+uid(),metadata:{entityId:target.id,entityName:(entity.name || entity.scene_heading || '分镜').slice(0,160),slot:target.kind,episode:entity.episode || d().episode}})).item;
        if(!alive(token))return; if(!item)throw Error('导入结果缺少图片记录，请刷新图库');
        commit(()=>acceptImage(getProject(),d(),`${target.id}:${target.kind}`,item)); await attachImage(target.id,target.kind,item,token); return;
      }
      if (el.hasAttribute('data-pc-file')) {
        const file=el.files?.[0]; if(!file)return;
        const text=await readScript(file); if(!alive(token))return;
        // Never replace existing work in place. A recoverable original stays in
        // the project; parse is an explicit, separate next step.
        commit(()=>{ const p=getProject(); if(p.script && p.script!==text)(d().scriptHistory ||= []).push({text:p.script,created:Date.now()}); p.script=text; d().scriptDrafts={}; d().scriptAll=false; d().episode=episodeNames(p)[0]; }); toast(`已导入 ${file.name}，请选择集数后拆解`);
      }
    } catch(err) { if(alive(token))error(err); }
  }
  function fileToData(file,max=768*1024) {
    if (file.size > max) throw Error(`图片请压缩到${max === 768*1024 ? '768KB' : '3MB'}以内`);
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('仅支持 PNG、JPEG、WebP 图片');
    return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(Error('读不到这张图片')); r.readAsDataURL(file); });
  }
  async function onClick(e) {
    if (!current()) return;
    const btn = e.target.closest('[data-pc]');
    if (!btn || !host?.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.pc;
    if (queue && !['cancel','refresh','view','slot','close-image','close-history'].includes(act)) return;
    try { if (await extraAction(act,btn)) return; } catch(err) { error(err); return; }
    if (act === 'tab') {
      const id = btn.dataset.tab;
      const dest = TABS.find(t => t.id === id)?.page;
      commit(() => { d().tab = id; });
      if (dest && dest !== pageKind) goto(dest);
      else paint();
      return;
    }
    if (act === 'aspect') {
      commit(() => { const desk=d(); const aspect=setEpisodeAspect(desk, desk.episode, btn.dataset.id); for (const b of desk.beats) if (b.episode===desk.episode) b.ratio=aspect; syncShots(getProject(), desk); });
      return;
    }
    if (act === 'resolution' || act === 'look' || act === 'scope') {
      commit(() => { d()[act === 'look' ? 'look' : act === 'scope' ? 'scope' : act] = btn.dataset.id; });
      return;
    }
    if (act === 'script-save') { try{commit(()=>applyScriptDraft(getProject(),scriptKey()));toast('剧本已保存');}catch(err){error(err)} return; }
    if (act === 'script-restore') { commit(()=>{delete (d().scriptDrafts ||= {})[scriptKey()]}); return; }
    if (act === 'script-mode') { commit(()=>{d().scriptAll=!d().scriptAll}); return; }
    if (act === 'import') { host.querySelector('[data-pc-file]')?.click(); return; }
    if (act === 'sample') { commit(() => { const p = getProject(); if(p.script)(d().scriptHistory ||= []).push({text:p.script,created:Date.now()}); p.script = SAMPLE;d().scriptDrafts={};d().scriptAll=false; if (!p.title || p.title === '未命名项目') p.title = '夜渡'; }); toast('已填入《夜渡》'); return; }
    if (act === 'parse') { parse(); return; }
    if (act === 'cancel') { if (queue) queue.stop = true; toast('正在取消，这一张出完就停'); return; }
    if (act === 'add-char') { commit(() => { d().characters.push({id: uid(), name: '新人物', scope: 'episode', episode:d().episode, role: '角色', age: '', gender: '', appearance: '', costume: ''}); }); return; }
    if (act === 'del-char') {
      const id = btn.dataset.id;
      const name = d().characters.find(c => c.id === id)?.name || '这个人';
      if (!confirm(`确定删除人物「${name}」？已有图片仍保留在图库。`)) return;
      commit(() => {
        const desk = d();
        const row = desk.characters.find(c=>c.id===id); if(row) row.archived=true;
      });
      return;
    }
    if (act === 'flip') {
      commit(() => { const row = listOf(btn.dataset.kind).find(x => x.id === btn.dataset.id); if (row) { row.scope = row.scope === 'series' ? 'episode' : 'series'; row.episode = d().episode; } });
      return;
    }
    if (act === 'insert-beat') {
      try { commit(() => { const desk=d(); desk.beats=insertBeatAfter(desk.beats, btn.dataset.id, uid); syncShots(getProject(), desk); }); }
      catch(err) { toast(ORDER_UNSAVED); error(err); }
      return;
    }
    if (act === 'add-scene') {
      try { commit(() => { const desk=d(); desk.beats=insertSceneAfter(desk.beats, desk.episode, btn.dataset.scene || '', uid); syncShots(getProject(), desk); }); }
      catch(err) { toast(ORDER_UNSAVED); error(err); }
      return;
    }
    if (act === 'add-beat') {
      commit(() => {
        const desk = d();
        const last = shownBeats().at(-1);
        const start = last ? Number(last.start_sec) + Number(last.duration_sec) + Number(last.next_gap_sec || 0) : 0;
        desk.beats.push({id: uid(), seq: desk.beats.length + 1, episode:desk.episode, scene_heading: '新分镜', action: '', dialogue: '', shot_size: '中景', composition: '眼睛平视', framing: '三分构图', camera_move: '固定镜头', stylize: '电影叙事', lighting: '电影级布光', technique: '', start_sec: start, duration_sec: 4, next_gap_sec: 0.5, script_excerpt: ''});
        syncShots(getProject(), desk);
      });
      return;
    }
    if (act === 'cite') {
      const beat = d().beats.find(b => b.id === btn.dataset.id);
      commit(() => { const b=d().beats.find(b=>b.id===btn.dataset.id);if(b)d().episode=b.episode;d().scriptAll=false; d().tab = 'script'; });
      if (pageKind !== 'script') goto('script');
      else paint();
      cite = beat?.script_excerpt || ''; focusSource();
      return;
    }
    if (act === 'one') {
      const {batch, id, kind} = btn.dataset;
      if (busyKey === `${id}:${kind}`) { if (queue) queue.stop = true; return; }
      void runJobs([{batch,id,kind,label:entityOf(batch,id)?.name || '分镜'}]);
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
  return {mount,unmount,parse,refresh};
}
