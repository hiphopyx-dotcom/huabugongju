import {apiFetch} from './api-client.mjs';
import {BUILTIN_FIGHT_ID, CAMERA_MOVES, CAMERA_POSITIONS, buildFightPrompt} from './fight-template.mjs';
import {STAGES, categoryLabel, clipSkillText, extractSkillPack, mergeSkillPrompt, normalizeCategory, normalizeStages} from './skill-import.mjs';

let enabled = false;
let catalog = [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function skillsActive() { return enabled; }
export function skillCatalog() { return catalog.map(item => ({...item})); }
export function bindSkillsForTest(on, skills = []) { enabled = !!on; catalog = skills; }

export async function refreshSkillLibrary(rerender) {
  const was = enabled;
  try {
    const response = await apiFetch('/api/skills?action=status');
    const data = await response.json().catch(() => ({}));
    enabled = response.ok && data.enabled === true;
    catalog = [];
    if (enabled) {
      const list = await apiFetch('/api/skills?action=list');
      if (list.ok) {
        const body = await list.json().catch(() => ({}));
        catalog = Array.isArray(body.skills) ? body.skills : [];
      }
    }
  } catch {
    enabled = false;
    catalog = [];
  }
  if (enabled && !was && typeof rerender === 'function') rerender();
  return enabled;
}

function choices(selected) {
  const options = [{id:'', name:'无'}, {id:BUILTIN_FIGHT_ID, name:'打戏'}, ...catalog.filter(item => item.enabled !== false && String(item.stages || 'video').split(',').includes('video')).map(item => ({id:item.id, name:item.name}))];
  return options.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
}
function field(label, control) { return `<label class="field">${label}${control}</label>`; }
function fightField(name, label, value, extra = '') {
  return field(label, `<input ${extra} data-setting="${name}" aria-label="${label}" value="${esc(value || '')}" maxlength="400">`);
}
function fightSelect(name, label, value, options) {
  return field(label, `<select data-setting="${name}" aria-label="${label}"><option value="">沿用默认</option>${options.map(item => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select>`);
}
function wholeFightFields(settings) {
  if (settings.videoSkillId !== BUILTIN_FIGHT_ID) return '';
  return `<div class="grid2">${fightField('videoFightCharacters','参战人物',settings.videoFightCharacters)}${fightField('videoFightWeapons','武器和左右手',settings.videoFightWeapons)}${fightField('videoFightScene','场景',settings.videoFightScene)}${fightField('videoFightImpacts','重击点（秒，最多两个）',settings.videoFightImpacts)}${fightField('videoFightRounds','来回',settings.videoFightRounds,'type="number" min="1" max="6"')}${fightField('videoFightEndPose','段尾姿势',settings.videoFightEndPose)}${fightSelect('videoFightCamera','主机位',settings.videoFightCamera,CAMERA_POSITIONS)}${fightSelect('videoFightMove','主运镜',settings.videoFightMove,CAMERA_MOVES)}${fightSelect('videoFightMotion','动作迁移',settings.videoFightMotion,[{id:'transfer', label:'每段不超过 9 秒'}])}</div><label class="field">这一段的动作<textarea data-setting="videoFightAction" aria-label="打戏动作" maxlength="1200">${esc(settings.videoFightAction || '')}</textarea></label>`;
}
function shotFightFields(shot) {
  if (shot.skillId !== BUILTIN_FIGHT_ID) return '';
  const input = (key, label) => field(label, `<input data-video-shot="${esc(shot.id)}" data-key="${key}" aria-label="${label}" value="${esc(shot[key] || '')}" maxlength="400">`);
  const select = (key, label, options) => field(label, `<select data-video-shot="${esc(shot.id)}" data-key="${key}" aria-label="${label}"><option value="">沿用默认</option>${options.map(item => `<option value="${esc(item.id)}" ${shot[key] === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select>`);
  return `<div class="grid2">${input('fightCharacters','参战人物')}${input('fightWeapons','武器和左右手')}${input('fightScene','场景')}${input('fightImpacts','重击点（秒）')}${input('fightRounds','来回')}${input('fightEndPose','段尾姿势')}${select('fightCamera','主机位',CAMERA_POSITIONS)}${select('fightMove','主运镜',CAMERA_MOVES)}${select('fightMotion','动作迁移',[{id:'transfer', label:'每段不超过 9 秒'}])}</div>`;
}

export function skillLibraryMarkup(project, isAdmin = false) {
  if (!enabled) return '';
  const settings = project?.settings || {};
  const cards = catalog.map(item => `<article class="video-template-card"><strong>${esc(item.name)}</strong><small>${esc(categoryLabel(item.category))}</small><span>${esc(item.description || '已导入的提示词')}</span></article>`).join('');
  const whole = settings.videoSequence ? '' : `${field('技能', `<select data-setting="videoSkillId" aria-label="视频技能">${choices(settings.videoSkillId || '')}</select>`)}${wholeFightFields(settings)}<div class="row wrap"><button type="button" data-act="skill-fight-append">追加打戏提示词</button><button type="button" data-act="skill-fight-replace">用打戏提示词替换</button></div>`;
  return `<section class="section video-skill-panel"><div class="row wrap"><div><small>SKILL LIBRARY</small><h3>技能库</h3></div><span class="spacer"></span>${isAdmin ? '<button type="button" data-act="skill-import">导入技能</button>' : '<small>技能由管理员导入</small>'}</div><p class="muted">技能只作为提示词文字拼到视频后面。每个技能最多 1500 字。默认不选。</p><div class="video-template-grid">${cards || '<p class="muted">还没有导入的技能。打戏模板可以直接用。</p>'}</div>${whole}</section>`;
}
export function shotSkillControl(shot, index) {
  if (!enabled || !shot) return '';
  return `${field('技能', `<select data-video-shot="${esc(shot.id)}" data-key="skillId" aria-label="镜头${index + 1}技能">${choices(shot.skillId || '')}</select>`)}${shotFightFields(shot)}`;
}
export function skillAdminEntry() {
  return enabled ? '<button data-account="skills">技能总览</button>' : '';
}

function referenceNotes(project, shot) {
  const ids = shot?.assetId ? [shot.assetId] : (project.settings?.videoRefs || []);
  return ids.map(id => project.assets?.find(asset => asset.id === id)).filter(Boolean).slice(0, 8).map(asset => ({name: asset.name, note: asset.name}));
}
export function fightInputFrom(project, shot) {
  const settings = project?.settings || {};
  const pick = (shotKey, settingKey) => String((shot ? shot[shotKey] : settings[settingKey]) || '').trim();
  const names = [...new Set((project?.shots || []).flatMap(item => item.characterNames || []))].filter(Boolean);
  return {
    duration: shot ? Number(shot.duration) || 5 : Number(settings.videoDuration) || 5,
    ratio: settings.videoRatio || settings.ratio || '16:9',
    scene: pick('fightScene', 'videoFightScene') || shot?.description || (project?.shots || []).map(item => item.scene).find(Boolean) || '',
    characters: pick('fightCharacters', 'videoFightCharacters') || names.join('、'),
    weapons: pick('fightWeapons', 'videoFightWeapons'),
    rounds: pick('fightRounds', 'videoFightRounds'),
    impacts: pick('fightImpacts', 'videoFightImpacts'),
    cameraId: pick('fightCamera', 'videoFightCamera'),
    moveId: pick('fightMove', 'videoFightMove'),
    endPose: pick('fightEndPose', 'videoFightEndPose'),
    motionTransfer: pick('fightMotion', 'videoFightMotion'),
    action: pick('fightAction', 'videoFightAction'),
    references: referenceNotes(project, shot),
    cameraWhere: pick('fightCameraWhere', 'videoFightCameraWhere'),
    cameraHeight: pick('fightCameraHeight', 'videoFightCameraHeight'),
    cameraFacing: pick('fightCameraFacing', 'videoFightCameraFacing'),
    cameraAim: pick('fightCameraAim', 'videoFightCameraAim'),
    moveLabel: pick('fightMoveLabel', 'videoFightMoveLabel'),
  };
}
function textForSkill(project, shot, skillId) {
  if (!skillId) return '';
  if (skillId === BUILTIN_FIGHT_ID) return buildFightPrompt(fightInputFrom(project, shot)).prompt;
  const skill = catalog.find(item => item.id === skillId && item.enabled !== false);
  return skill?.body || '';
}
export function projectSkillText(project) {
  if (!enabled || !project) return '';
  const settings = project.settings || {};
  if (settings.videoSequence) {
    return (settings.videoShots || []).map(shot => clipSkillText(textForSkill(project, shot, shot.skillId)).text).filter(Boolean).join('\n\n');
  }
  return clipSkillText(textForSkill(project, null, settings.videoSkillId)).text;
}
export function skillUses(project) {
  if (!enabled || !project) return [];
  const settings = project.settings || {};
  if (settings.videoSequence) {
    return (settings.videoShots || []).filter(shot => shot.skillId).map(shot => ({skillId: shot.skillId, projectId: project.id, shotId: shot.id, stage: 'video'}));
  }
  return settings.videoSkillId ? [{skillId: settings.videoSkillId, projectId: project.id, shotId: '', stage: 'video'}] : [];
}
export function noteSkillUses(project) {
  if (!skillsActive()) return;
  const uses = skillUses(project);
  if (!uses.length) return;
  apiFetch('/api/skills?action=use', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uses})}).catch(() => {});
}
export {mergeSkillPrompt};

async function skillRequest(action, body) {
  const response = await apiFetch('/api/skills?action=' + encodeURIComponent(action), body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : undefined);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || '技能库请求失败');
  return data;
}
function formatTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '—';
  try { return new Date(time).toLocaleString('zh-CN'); } catch { return '—'; }
}
function stageLabels(value) {
  const ids = Array.isArray(value) ? value : String(value || 'video').split(',');
  return ids.map(id => STAGES.find(stage => stage.id === id)?.label || id).join('、') || '视频';
}
export function overviewMarkup(data) {
  const rows = [...(data.builtin || []), ...(data.skills || [])];
  const body = rows.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.description || categoryLabel(item.category))}</td><td>${item.enabled ? '启用' : '停用'}</td><td>${item.builtin ? '内置' : formatTime(item.importedAt)}</td><td>${esc(stageLabels(item.stages))}</td><td>${Number(item.uses) || 0}</td><td>${formatTime(item.lastUsedAt)}</td><td>${item.builtin ? '随总开关' : `<button type="button" data-account="skill-toggle" data-id="${esc(item.id)}" data-enabled="${item.enabled ? '0' : '1'}">${item.enabled ? '停用' : '启用'}</button><button type="button" data-account="skill-delete" data-id="${esc(item.id)}">删除</button>`}</td></tr>`).join('');
  return `<h2>技能总览</h2><p class="muted">只有管理员可以导入、删除和启停。删除后下拉框不再出现，已经记下的使用次数保留。</p><table class="line-table"><thead><tr><th>名称</th><th>用途</th><th>启用</th><th>导入时间</th><th>适用阶段</th><th>使用次数</th><th>最近使用</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="8">还没有技能</td></tr>'}</tbody></table>`;
}
export async function handleSkillAdmin(act, button, {modal, error}) {
  if (!skillsActive()) return;
  try {
    if (act === 'skills') {
      modal(overviewMarkup(await skillRequest('overview')));
      return;
    }
    const id = button?.dataset?.id || '';
    if (act === 'skill-toggle') await skillRequest('update', {id, enabled: button.dataset.enabled === '1'});
    if (act === 'skill-delete') {
      if (!globalThis.confirm?.('删除这个技能？已记录的使用次数会保留。')) return;
      await skillRequest('delete', {id, confirm: true});
    }
    modal(overviewMarkup(await skillRequest('overview')));
  } catch (err) { error?.(err.message); }
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function openSkillImport({modal, toast, rerender, isAdmin}) {
  if (!skillsActive()) return;
  if (!isAdmin?.()) { toast?.('只有管理员可以导入技能'); return; }
  const stageBoxes = STAGES.map(stage => `<label><input type="checkbox" data-skill-stage="${stage.id}" ${stage.id === 'video' ? 'checked' : ''}> ${stage.label}</label>`).join(' ');
  modal(`<h2>导入技能</h2><p class="muted">选择带 SKILL.md 的文件夹或 zip。只保留 Markdown 文字，保存前可以预览。打包不超过 2MB，解包不超过 5MB，最多 30 个文件。</p><input type="file" data-skill-zip accept=".zip,application/zip"><input type="file" data-skill-dir webkitdirectory multiple><div data-skill-preview></div><label class="field">分类<select data-skill-category>${['fight','camera','dance','emotion','other'].map(id => `<option value="${id}">${categoryLabel(id)}</option>`).join('')}</select></label><div class="row wrap">${stageBoxes}</div><p data-skill-error class="form-error" role="alert"></p><button type="button" data-skill-save class="primary" disabled>确认导入</button>`);
  const root = document.querySelector('#modalBody');
  let payload = null;
  const preview = root.querySelector('[data-skill-preview]');
  const error = root.querySelector('[data-skill-error]');
  const save = root.querySelector('[data-skill-save]');
  const category = root.querySelector('[data-skill-category]');
  async function show(next) {
    payload = next.payload;
    const parsed = next.parsed;
    category.value = parsed.category;
    preview.textContent = `${parsed.name}\n${parsed.description}\n\n${parsed.body}`.slice(0, 4000);
    error.textContent = (parsed.warnings || []).join('');
    save.disabled = false;
  }
  root.querySelector('[data-skill-zip]').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('压缩包超过 2MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await extractSkillPack({zipBytes: bytes});
      await show({payload:{zipBase64: bytesToBase64(bytes)}, parsed});
    } catch (err) { error.textContent = err.message; save.disabled = true; }
  };
  root.querySelector('[data-skill-dir]').onchange = async event => {
    try {
      const files = [];
      for (const file of event.target.files || []) files.push({path: file.webkitRelativePath || file.name, text: await file.text()});
      const parsed = await extractSkillPack({files});
      await show({payload:{files}, parsed});
    } catch (err) { error.textContent = err.message; save.disabled = true; }
  };
  save.onclick = async () => {
    if (!payload) return;
    save.disabled = true;
    try {
      const stages = [...root.querySelectorAll('[data-skill-stage]:checked')].map(item => item.dataset.skillStage);
      await skillRequest('import', {...payload, category: normalizeCategory(category.value), stages: normalizeStages(stages), confirm: true});
      toast?.('技能已导入');
      await refreshSkillLibrary(rerender);
      if (typeof rerender === 'function') rerender();
      document.querySelector('#modal').style.display = 'none';
    } catch (err) { error.textContent = err.message; save.disabled = false; }
  };
}

export function applyBuiltinFight(project, mode) {
  const built = buildFightPrompt(fightInputFrom(project, null));
  const clipped = clipSkillText(built.prompt);
  const current = project.settings?.videoPrompt || '';
  const prompt = mode === 'append' ? [current, clipped.text].filter(Boolean).join('\n\n') : clipped.text;
  return {prompt, truncated: clipped.truncated};
}
